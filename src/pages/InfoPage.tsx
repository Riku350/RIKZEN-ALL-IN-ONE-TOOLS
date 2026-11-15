import React from 'react';
import { ArrowLeft, Lock, Mail, ShieldCheck } from 'lucide-react';

type InfoSlug = 'privacy' | 'terms' | 'security' | 'about' | 'contact';

const CONTENT: Record<InfoSlug, { title: string; subtitle: string; sections: { heading: string; body: string }[] }> = {
  privacy: {
    title: 'Privacy Policy',
    subtitle: 'How RIKZEN handles your files and Google account data.',
    sections: [
      {
        heading: 'Temporary File Processing',
        body: 'Uploaded files are processed in memory or isolated temporary storage and automatically deleted after 30 minutes. We do not sell, inspect, or train models on your uploaded files.',
      },
      {
        heading: 'Google Account Information',
        body: 'When you sign in with Google, we store only your UID, display name, email, and profile photo to power your private Files, History, and Favorites.',
      },
      {
        heading: 'Privacy-Conscious Analytics',
        body: 'We track aggregate tool usage counts (such as tool opened and processing completed) without attaching personal files or private content.',
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    subtitle: 'Simple terms for using RIKZEN All-in-One Tools.',
    sections: [
      {
        heading: 'Acceptable Use',
        body: 'Use RIKZEN tools only on files and documents you own or have permission to edit. Automated abuse, malware uploads, or bypassing rate limits is prohibited.',
      },
      {
        heading: 'Temporary Storage',
        body: 'Processed files are retained temporarily for quick download and convenience. Keep backups of important documents on your own device.',
      },
    ],
  },
  security: {
    title: 'Security Architecture',
    subtitle: 'Defense-in-depth across uploads, authentication, and storage.',
    sections: [
      {
        heading: 'Magic-Byte Validation & Size Limits',
        body: 'Every uploaded file is verified by both MIME type and binary file signature (magic bytes) with strict upload size caps.',
      },
      {
        heading: 'Private User Isolation',
        body: 'Download endpoints require either a verified Firebase ID token matching the file owner or a short-lived HMAC-signed operation token.',
      },
      {
        heading: 'Automatic Cleanup',
        body: 'A background cleanup loop permanently deletes expired temporary files from disk so sensitive files never linger.',
      },
    ],
  },
  about: {
    title: 'About RIKZEN',
    subtitle: 'Everything You Need. One Simple Place.',
    sections: [
      {
        heading: 'Built for Clarity',
        body: 'RIKZEN brings everyday image, PDF, document, QR, and student utilities together inside one clean, fast, mobile-first web application.',
      },
      {
        heading: 'Honest Capabilities',
        body: 'Every tool on RIKZEN runs real server-side or browser-side processing. Features that require external keys or binaries clearly state their configuration status.',
      },
    ],
  },
  contact: {
    title: 'Contact RIKZEN',
    subtitle: 'Questions, feedback, or enterprise inquiries.',
    sections: [
      {
        heading: 'Support',
        body: 'Reach our team anytime for bug reports, feature requests, or security disclosures at support@rikzen.tools.',
      },
    ],
  },
};

export const InfoPage: React.FC<{ slug: InfoSlug; onNavigate: (path: string) => void }> = ({
  slug,
  onNavigate,
}) => {
  const page = CONTENT[slug];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6 pb-24 md:pb-16">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="min-h-[40px] inline-flex items-center gap-2 text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] hover:text-[#111214] dark:hover:text-[#F4F4F0] cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Home</span>
      </button>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#C9A227]">
          {slug === 'security' ? <Lock className="w-4 h-4" /> : slug === 'contact' ? <Mail className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
          <span>RIKZEN</span>
        </div>
        <h1 className="text-3xl font-extrabold">{page.title}</h1>
        <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA]">{page.subtitle}</p>
      </div>

      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] divide-y divide-[#F0F0EC] dark:divide-[#1E2128]">
        {page.sections.map((sec) => (
          <div key={sec.heading} className="p-6 space-y-2">
            <h2 className="text-base font-bold">{sec.heading}</h2>
            <p className="text-sm text-[#5A5D65] dark:text-[#9CA0AA] leading-relaxed">{sec.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
