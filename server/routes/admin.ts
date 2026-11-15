import { Router } from 'express';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  AuthRequest,
  adminDb,
  isAdminUser,
  optionalAuth,
  requireAdmin,
  requireAuth,
} from '../firebaseAdmin.ts';
import { getStorageStats } from '../tempStorage.ts';
import { getQrLimits } from '../qrStorage.ts';
import { checkQpdfAvailable, getProcessingLimits } from './tools.ts';

const router = Router();

// Public runtime config & active announcements
router.get('/public/config', optionalAuth, async (req: AuthRequest, res) => {
  const limits = getProcessingLimits();
  const qrLimits = getQrLimits();
  try {
    const [annSnap, cfgSnap, isAdmin, qpdfAvailable] = await Promise.all([
      adminDb.collection('announcements').where('active', '==', true).limit(5).get(),
      adminDb.collection('tool_configs').get(),
      isAdminUser(req.user),
      checkQpdfAvailable(),
    ]);

    const announcements = annSnap.docs.map((d) => ({
      id: d.id,
      title: d.data().title,
      message: d.data().message,
    }));

    const toolConfigs: Record<string, { enabled: boolean; maxFileSizeMb: number }> = {};
    cfgSnap.docs.forEach((d) => {
      toolConfigs[d.id] = {
        enabled: d.data().enabled !== false,
        maxFileSizeMb: Number(d.data().maxFileSizeMb || limits.maxFileSizeMb),
      };
    });

    res.json({
      isAdmin,
      capabilities: {
        removeBgConfigured: Boolean(process.env.REMOVEBG_API_KEY),
        qpdfAvailable,
        maxUploadMb: limits.maxFileSizeMb,
        maxFileSizeMb: limits.maxFileSizeMb,
        maxFilesPerBatch: limits.maxFilesPerBatch,
        maxTotalBatchSizeMb: limits.maxTotalBatchSizeMb,
        maxProcessingTimeMs: limits.maxProcessingTimeMs,
        maxConcurrentJobs: limits.maxConcurrentJobs,
        tempTtlMinutes: Number(process.env.TEMP_FILE_TTL_MINUTES || '30'),
        ...qrLimits,
      },
      announcements,
      toolConfigs,
    });
  } catch (err) {
    console.error('Public config error:', err);
    res.json({
      isAdmin: false,
      capabilities: {
        removeBgConfigured: Boolean(process.env.REMOVEBG_API_KEY),
        qpdfAvailable: false,
        maxUploadMb: limits.maxFileSizeMb,
        maxFileSizeMb: limits.maxFileSizeMb,
        maxFilesPerBatch: limits.maxFilesPerBatch,
        maxTotalBatchSizeMb: limits.maxTotalBatchSizeMb,
        maxProcessingTimeMs: limits.maxProcessingTimeMs,
        maxConcurrentJobs: limits.maxConcurrentJobs,
        tempTtlMinutes: Number(process.env.TEMP_FILE_TTL_MINUTES || '30'),
        ...qrLimits,
      },
      announcements: [],
      toolConfigs: {},
    });
  }
});

// Privacy-conscious analytics event ingestion
router.post('/analytics/event', async (req, res) => {
  const allowedEvents = new Set([
    'tool_opened',
    'file_uploaded',
    'processing_started',
    'processing_completed',
    'download_clicked',
    'favorite_added',
  ]);
  const event = String(req.body?.event || '');
  const toolId = String(req.body?.toolId || '').slice(0, 80);
  const category = String(req.body?.category || '').slice(0, 60);

  if (!allowedEvents.has(event) || !toolId) {
    res.status(400).json({ error: 'Invalid analytics event.' });
    return;
  }

  try {
    await adminDb.collection('analytics_events').add({
      event,
      toolId,
      category,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

// Clear authenticated user's history
router.delete('/history/clear', requireAuth, async (req: AuthRequest, res) => {
  try {
    const uid = req.user!.uid;
    const snap = await adminDb.collection('tool_history').where('userId', '==', uid).limit(200).get();
    const batch = adminDb.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ ok: true, deleted: snap.size });
  } catch (err) {
    console.error('Clear history error:', err);
    res.status(500).json({ error: 'Could not clear history.' });
  }
});

// Admin Overview & Stats (RBAC protected)
router.get('/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [usersSnap, historySnap, filesSnap, annSnap, cfgSnap] = await Promise.all([
      adminDb.collection('users').orderBy('createdAt', 'desc').limit(100).get(),
      adminDb.collection('tool_history').orderBy('createdAt', 'desc').limit(500).get(),
      adminDb.collection('files').orderBy('createdAt', 'desc').limit(200).get(),
      adminDb.collection('announcements').orderBy('createdAt', 'desc').limit(20).get(),
      adminDb.collection('tool_configs').get(),
    ]);

    const toolUsageMap = new Map<string, { toolId: string; toolName: string; count: number; errors: number }>();
    let totalErrors = 0;
    const activeUserIds = new Set<string>();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    historySnap.docs.forEach((d) => {
      const data = d.data();
      const tId = String(data.toolId || 'unknown');
      const tName = String(data.toolName || tId);
      const entry = toolUsageMap.get(tId) || { toolId: tId, toolName: tName, count: 0, errors: 0 };
      entry.count += 1;
      if (data.status === 'failed') {
        entry.errors += 1;
        totalErrors += 1;
      }
      toolUsageMap.set(tId, entry);

      const ts = data.createdAt?.toMillis?.() || 0;
      if (ts > sevenDaysAgo && data.userId) {
        activeUserIds.add(data.userId);
      }
    });

    const popularTools = Array.from(toolUsageMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    let firestoreFileBytes = 0;
    filesSnap.docs.forEach((d) => {
      firestoreFileBytes += Number(d.data().sizeBytes || 0);
    });

    const tempStats = getStorageStats();

    res.json({
      stats: {
        totalUsers: usersSnap.size,
        activeUsers7d: activeUserIds.size,
        totalOperations: historySnap.size,
        errorCount: totalErrors,
        tempFilesActive: tempStats.activeFiles,
        tempStorageBytes: tempStats.totalBytes,
        recordedFileBytes: firestoreFileBytes,
      },
      popularTools,
      users: usersSnap.docs.map((d) => ({
        uid: d.id,
        email: d.data().email,
        displayName: d.data().displayName || '',
        role: d.data().role || 'user',
        language: d.data().language || 'en',
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      })),
      announcements: annSnap.docs.map((d) => ({
        id: d.id,
        title: d.data().title,
        message: d.data().message,
        active: Boolean(d.data().active),
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      })),
      toolConfigs: cfgSnap.docs.map((d) => ({
        toolId: d.id,
        enabled: d.data().enabled !== false,
        maxFileSizeMb: Number(d.data().maxFileSizeMb || 25),
      })),
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Could not load admin statistics.' });
  }
});

router.post('/admin/tools/:toolId', requireAuth, requireAdmin, async (req, res) => {
  const { toolId } = req.params;
  const enabled = req.body?.enabled !== false;
  const maxFileSizeMb = Math.min(100, Math.max(1, Number(req.body?.maxFileSizeMb || 25)));

  try {
    await adminDb.collection('tool_configs').doc(toolId).set({
      toolId,
      enabled,
      maxFileSizeMb,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, toolId, enabled, maxFileSizeMb });
  } catch (err) {
    console.error('Update tool config error:', err);
    res.status(500).json({ error: 'Could not update tool settings.' });
  }
});

router.post('/admin/announcements', requireAuth, requireAdmin, async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 160);
  const message = String(req.body?.message || '').trim().slice(0, 600);
  if (!title || !message) {
    res.status(400).json({ error: 'Title and message are required.' });
    return;
  }

  try {
    const id = crypto.randomUUID().replace(/-/g, '');
    await adminDb.collection('announcements').doc(id).set({
      id,
      title,
      message,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Could not publish announcement.' });
  }
});

router.patch('/admin/announcements/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const active = Boolean(req.body?.active);
  try {
    await adminDb.collection('announcements').doc(id).update({ active });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not update announcement.' });
  }
});

router.delete('/admin/announcements/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await adminDb.collection('announcements').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not delete announcement.' });
  }
});

router.patch('/admin/users/:uid', requireAuth, requireAdmin, async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  try {
    await adminDb.collection('users').doc(req.params.uid).update({
      role,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (role === 'admin') {
      await adminDb.collection('admins').doc(req.params.uid).set({ createdAt: FieldValue.serverTimestamp() });
    } else {
      await adminDb.collection('admins').doc(req.params.uid).delete();
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not update user role.' });
  }
});

export default router;
