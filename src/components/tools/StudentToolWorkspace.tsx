import React, { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { ToolDefinition } from '../../lib/toolRegistry';
import { logClientToolExecution } from '../../lib/formatters';

export const StudentToolWorkspace: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  useEffect(() => {
    void logClientToolExecution({
      toolId: tool.id,
      toolName: tool.name,
      category: tool.category,
      fileName: tool.name,
    });
  }, [tool.id, tool.name, tool.category]);

  switch (tool.id) {
    case 'percentage-calculator':
      return <PercentageCalc />;
    case 'cgpa-calculator':
      return <CgpaCalc />;
    case 'marks-calculator':
      return <MarksCalc />;
    case 'attendance-calculator':
      return <AttendanceCalc />;
    case 'age-calculator':
      return <AgeCalc />;
    case 'unit-converter':
      return <UnitConverter />;
    case 'study-timer':
      return <StudyTimer />;
    case 'simple-calculator':
    default:
      return <SimpleCalculator />;
  }
};

const PercentageCalc: React.FC = () => {
  const [part, setPart] = useState('425');
  const [total, setTotal] = useState('500');
  const [pctOf, setPctOf] = useState('18');
  const [baseNum, setBaseNum] = useState('1200');
  const [fromVal, setFromVal] = useState('80');
  const [toVal, setToVal] = useState('96');

  const p1 = Number(total) > 0 ? ((Number(part) / Number(total)) * 100).toFixed(2) : '0.00';
  const p2 = ((Number(pctOf) / 100) * Number(baseNum)).toFixed(2);
  const p3 =
    Number(fromVal) !== 0
      ? (((Number(toVal) - Number(fromVal)) / Math.abs(Number(fromVal))) * 100).toFixed(2)
      : '0.00';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
        <h3 className="text-sm font-bold">Marks / Share Percentage</h3>
        <div className="space-y-2.5">
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            Value / Marks Obtained
            <input type="number" value={part} onChange={(e) => setPart(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            Out of Total
            <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
        </div>
        <div className="pt-3 border-t border-[#F0F0EC] dark:border-[#1E2128]">
          <div className="text-xs text-[#6B707B]">Result</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#C9A227]">{p1}%</div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
        <h3 className="text-sm font-bold">What is X% of Y?</h3>
        <div className="space-y-2.5">
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            Percentage (%)
            <input type="number" value={pctOf} onChange={(e) => setPctOf(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            Of Number
            <input type="number" value={baseNum} onChange={(e) => setBaseNum(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
        </div>
        <div className="pt-3 border-t border-[#F0F0EC] dark:border-[#1E2128]">
          <div className="text-xs text-[#6B707B]">Result</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#111214] dark:text-[#F4F4F0]">{p2}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-4">
        <h3 className="text-sm font-bold">Percentage Change</h3>
        <div className="space-y-2.5">
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            Initial Value
            <input type="number" value={fromVal} onChange={(e) => setFromVal(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
          <label className="block text-xs text-[#5A5D65] dark:text-[#9CA0AA]">
            New Value
            <input type="number" value={toVal} onChange={(e) => setToVal(e.target.value)} className="mt-1 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
          </label>
        </div>
        <div className="pt-3 border-t border-[#F0F0EC] dark:border-[#1E2128]">
          <div className="text-xs text-[#6B707B]">Change</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#111214] dark:text-[#F4F4F0]">
            {Number(p3) > 0 ? `+${p3}%` : `${p3}%`}
          </div>
        </div>
      </div>
    </div>
  );
};

const CgpaCalc: React.FC = () => {
  const [scale, setScale] = useState<'10' | '4'>('10');
  const [rows, setRows] = useState([
    { name: 'Semester 1', gpa: '8.4', credits: '20' },
    { name: 'Semester 2', gpa: '8.8', credits: '22' },
    { name: 'Semester 3', gpa: '9.0', credits: '24' },
  ]);

  const { cgpa, totalCredits, percentApprox } = useMemo(() => {
    let weighted = 0;
    let creds = 0;
    for (const r of rows) {
      const g = Number(r.gpa) || 0;
      const c = Number(r.credits) || 0;
      weighted += g * c;
      creds += c;
    }
    const avg = creds > 0 ? weighted / creds : 0;
    const pct = scale === '10' ? avg * 9.5 : (avg / 4) * 100;
    return {
      cgpa: avg.toFixed(2),
      totalCredits: creds,
      percentApprox: pct.toFixed(1),
    };
  }, [rows, scale]);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScale('10')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
              scale === '10'
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                : 'border-[#DADAD4] dark:border-[#2C303A]'
            }`}
          >
            10.0 Scale
          </button>
          <button
            type="button"
            onClick={() => setScale('4')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
              scale === '4'
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                : 'border-[#DADAD4] dark:border-[#2C303A]'
            }`}
          >
            4.0 Scale
          </button>
        </div>

        <button
          type="button"
          onClick={() =>
            setRows((prev) => [
              ...prev,
              { name: `Semester ${prev.length + 1}`, gpa: '8.0', credits: '20' },
            ])
          }
          className="min-h-[40px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add Row
        </button>
      </div>

      <div className="space-y-2.5">
        {rows.map((row, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2.5 items-center">
            <input
              type="text"
              value={row.name}
              onChange={(e) => {
                const next = [...rows];
                next[idx].name = e.target.value;
                setRows(next);
              }}
              className="col-span-5 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm"
            />
            <input
              type="number"
              step="0.01"
              max={Number(scale)}
              value={row.gpa}
              onChange={(e) => {
                const next = [...rows];
                next[idx].gpa = e.target.value;
                setRows(next);
              }}
              aria-label="GPA"
              placeholder="GPA"
              className="col-span-3 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums"
            />
            <input
              type="number"
              min="1"
              value={row.credits}
              onChange={(e) => {
                const next = [...rows];
                next[idx].credits = e.target.value;
                setRows(next);
              }}
              aria-label="Credits"
              placeholder="Credits"
              className="col-span-3 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums"
            />
            <button
              type="button"
              onClick={() => rows.length > 1 && setRows(rows.filter((_, i) => i !== idx))}
              aria-label="Remove row"
              className="col-span-1 min-h-[44px] flex items-center justify-center text-[#8E939E] hover:text-red-500 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-[#E5E5E0] dark:border-[#242832] grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-[#6B707B]">Cumulative CGPA</div>
          <div className="text-3xl font-bold font-mono tabular-nums text-[#C9A227]">{cgpa}</div>
        </div>
        <div>
          <div className="text-xs text-[#6B707B]">Approx. Percentage</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{percentApprox}%</div>
        </div>
        <div>
          <div className="text-xs text-[#6B707B]">Total Credits</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{totalCredits}</div>
        </div>
      </div>
    </div>
  );
};

const MarksCalc: React.FC = () => {
  const [subjects, setSubjects] = useState([
    { name: 'Mathematics', obtained: '88', max: '100' },
    { name: 'Science', obtained: '84', max: '100' },
    { name: 'English', obtained: '91', max: '100' },
    { name: 'Computer Science', obtained: '95', max: '100' },
  ]);

  const summary = useMemo(() => {
    const totalObt = subjects.reduce((a, s) => a + (Number(s.obtained) || 0), 0);
    const totalMax = subjects.reduce((a, s) => a + (Number(s.max) || 0), 0);
    const pct = totalMax > 0 ? (totalObt / totalMax) * 100 : 0;
    const grade =
      pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B+' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 35 ? 'D' : 'F';
    return { totalObt, totalMax, pct: pct.toFixed(2), grade };
  }, [subjects]);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="flex justify-between items-center">
        <span className="text-sm font-bold">Subject Marks</span>
        <button
          type="button"
          onClick={() =>
            setSubjects((s) => [...s, { name: `Subject ${s.length + 1}`, obtained: '75', max: '100' }])
          }
          className="min-h-[40px] px-4 rounded-xl border border-[#DADAD4] dark:border-[#2C303A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add Subject
        </button>
      </div>

      <div className="space-y-2.5">
        {subjects.map((subj, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2.5 items-center">
            <input
              type="text"
              value={subj.name}
              onChange={(e) => {
                const next = [...subjects];
                next[idx].name = e.target.value;
                setSubjects(next);
              }}
              className="col-span-5 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm"
            />
            <input
              type="number"
              value={subj.obtained}
              onChange={(e) => {
                const next = [...subjects];
                next[idx].obtained = e.target.value;
                setSubjects(next);
              }}
              aria-label="Obtained marks"
              className="col-span-3 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums"
            />
            <input
              type="number"
              value={subj.max}
              onChange={(e) => {
                const next = [...subjects];
                next[idx].max = e.target.value;
                setSubjects(next);
              }}
              aria-label="Max marks"
              className="col-span-3 min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-mono tabular-nums"
            />
            <button
              type="button"
              onClick={() => subjects.length > 1 && setSubjects(subjects.filter((_, i) => i !== idx))}
              aria-label="Remove subject"
              className="col-span-1 min-h-[44px] flex items-center justify-center text-[#8E939E] hover:text-red-500 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-[#E5E5E0] dark:border-[#242832] grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-[#6B707B]">Total Score</div>
          <div className="text-2xl font-bold font-mono tabular-nums">
            {summary.totalObt} / {summary.totalMax}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#6B707B]">Percentage</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[#C9A227]">{summary.pct}%</div>
        </div>
        <div>
          <div className="text-xs text-[#6B707B]">Grade</div>
          <div className="text-2xl font-bold font-mono">{summary.grade}</div>
        </div>
      </div>
    </div>
  );
};

const AttendanceCalc: React.FC = () => {
  const [attended, setAttended] = useState('42');
  const [conducted, setConducted] = useState('54');
  const [target, setTarget] = useState('75');

  const att = Math.max(0, Number(attended) || 0);
  const tot = Math.max(1, Number(conducted) || 1);
  const tgt = Math.min(99, Math.max(1, Number(target) || 75)) / 100;
  const currentPct = (att / tot) * 100;

  let guidance = '';
  if (currentPct >= tgt * 100) {
    const canMiss = Math.floor(att / tgt - tot);
    guidance =
      canMiss > 0
        ? `You are above ${Math.round(tgt * 100)}%. You can safely miss up to ${canMiss} upcoming class${canMiss > 1 ? 'es' : ''}.`
        : `You are right on target (${Math.round(tgt * 100)}%). Attend the next class to stay safe.`;
  } else {
    const need = Math.ceil((tgt * tot - att) / (1 - tgt));
    guidance = `You need to attend ${need} consecutive class${need > 1 ? 'es' : ''} without missing any to reach ${Math.round(tgt * 100)}%.`;
  }

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Classes Attended
          <input type="number" min={0} value={attended} onChange={(e) => setAttended(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
        </label>
        <label className="block text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Total Classes Held
          <input type="number" min={1} value={conducted} onChange={(e) => setConducted(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
        </label>
        <label className="block text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Target (%)
          <input type="number" min={1} max={99} value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono tabular-nums" />
        </label>
      </div>

      <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] border border-[#E5E5E0] dark:border-[#242832] p-5 space-y-2">
        <div className="text-xs text-[#6B707B]">Current Attendance</div>
        <div className={`text-4xl font-bold font-mono tabular-nums ${currentPct >= tgt * 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {currentPct.toFixed(1)}%
        </div>
        <p className="text-sm text-[#111214] dark:text-[#F4F4F0] pt-1">{guidance}</p>
      </div>
    </div>
  );
};

const AgeCalc: React.FC = () => {
  const [dob, setDob] = useState('2004-06-15');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  const details = useMemo(() => {
    const start = new Date(dob);
    const end = new Date(asOf);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;

    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();

    if (days < 0) {
      months -= 1;
      const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
      days += prevMonth.getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }

    const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const nextBday = new Date(end.getFullYear(), start.getMonth(), start.getDate());
    if (nextBday <= end) nextBday.setFullYear(end.getFullYear() + 1);
    const daysToBday = Math.ceil((nextBday.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));

    return { years, months, days, totalDays, daysToBday };
  }, [dob, asOf]);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Date of Birth
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono" />
        </label>
        <label className="block text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA]">
          Age at Date
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="mt-1.5 w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3.5 text-sm font-mono" />
        </label>
      </div>

      {details ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] p-4 border border-[#E5E5E0] dark:border-[#242832]">
            <div className="text-xs text-[#6B707B]">Years</div>
            <div className="text-3xl font-bold font-mono tabular-nums text-[#C9A227]">{details.years}</div>
          </div>
          <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] p-4 border border-[#E5E5E0] dark:border-[#242832]">
            <div className="text-xs text-[#6B707B]">Months · Days</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{details.months}m {details.days}d</div>
          </div>
          <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] p-4 border border-[#E5E5E0] dark:border-[#242832]">
            <div className="text-xs text-[#6B707B]">Total Days Lived</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{details.totalDays.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0F1116] p-4 border border-[#E5E5E0] dark:border-[#242832]">
            <div className="text-xs text-[#6B707B]">Next Birthday</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{details.daysToBday} days</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-amber-600">Select a valid birth date earlier than the target date.</p>
      )}
    </div>
  );
};

const UNIT_GROUPS: Record<string, Record<string, number>> = {
  Length: { Meter: 1, Kilometer: 1000, Centimeter: 0.01, Millimeter: 0.001, Mile: 1609.344, Foot: 0.3048, Inch: 0.0254 },
  Weight: { Kilogram: 1, Gram: 0.001, Milligram: 0.000001, Pound: 0.453592, Ounce: 0.0283495, Tonne: 1000 },
  Data: { Byte: 1, Kilobyte: 1024, Megabyte: 1048576, Gigabyte: 1073741824, Terabyte: 1099511627776 },
  Speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704 },
};

const UnitConverter: React.FC = () => {
  const [group, setGroup] = useState<'Length' | 'Weight' | 'Data' | 'Speed' | 'Temperature'>('Length');
  const [value, setValue] = useState('1');
  const [fromUnit, setFromUnit] = useState('Kilometer');
  const [toUnit, setToUnit] = useState('Meter');

  const unitKeys = group === 'Temperature' ? ['Celsius', 'Fahrenheit', 'Kelvin'] : Object.keys(UNIT_GROUPS[group]);

  useEffect(() => {
    const keys = group === 'Temperature' ? ['Celsius', 'Fahrenheit', 'Kelvin'] : Object.keys(UNIT_GROUPS[group]);
    setFromUnit(keys[0]);
    setToUnit(keys[1] || keys[0]);
  }, [group]);

  const converted = useMemo(() => {
    const v = Number(value);
    if (!Number.isFinite(v)) return '0';
    if (group === 'Temperature') {
      let c = v;
      if (fromUnit === 'Fahrenheit') c = ((v - 32) * 5) / 9;
      else if (fromUnit === 'Kelvin') c = v - 273.15;
      if (toUnit === 'Fahrenheit') return ((c * 9) / 5 + 32).toFixed(4).replace(/\.?0+$/, '');
      if (toUnit === 'Kelvin') return (c + 273.15).toFixed(4).replace(/\.?0+$/, '');
      return c.toFixed(4).replace(/\.?0+$/, '');
    }
    const table = UNIT_GROUPS[group];
    const base = v * (table[fromUnit] || 1);
    const res = base / (table[toUnit] || 1);
    return Number(res.toPrecision(8)).toString();
  }, [group, value, fromUnit, toUnit]);

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-6 space-y-5">
      <div className="flex flex-wrap gap-2">
        {(['Length', 'Weight', 'Temperature', 'Data', 'Speed'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
              group === g
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                : 'border-[#DADAD4] dark:border-[#2C303A] text-[#5A5D65] dark:text-[#9CA0AA]'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <select value={fromUnit} onChange={(e) => setFromUnit(e.target.value)} className="w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-medium">
            {unitKeys.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-full min-h-[50px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-4 text-xl font-bold font-mono tabular-nums" />
        </div>
        <div className="space-y-2">
          <select value={toUnit} onChange={(e) => setToUnit(e.target.value)} className="w-full min-h-[44px] rounded-xl border border-[#DADAD4] dark:border-[#2C303A] bg-[#FAFAF8] dark:bg-[#0F1116] px-3 text-sm font-medium">
            {unitKeys.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="w-full min-h-[50px] rounded-xl border border-[#E5E5E0] dark:border-[#242832] bg-[#FAFAF8] dark:bg-[#0F1116] px-4 flex items-center text-xl font-bold font-mono tabular-nums text-[#C9A227]">
            {converted}
          </div>
        </div>
      </div>
    </div>
  );
};

const StudyTimer: React.FC = () => {
  const [presetMins, setPresetMins] = useState(25);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setRunning(false);
          setSessions((s) => s + 1);
          return presetMins * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, presetMins]);

  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const secs = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-7 text-center space-y-6">
      <div className="flex flex-wrap justify-center gap-2">
        {[
          { label: 'Focus 25m', m: 25 },
          { label: 'Deep 50m', m: 50 },
          { label: 'Break 5m', m: 5 },
          { label: 'Long Break 15m', m: 15 },
        ].map((p) => (
          <button
            key={p.m}
            type="button"
            onClick={() => {
              setRunning(false);
              setPresetMins(p.m);
              setSecondsLeft(p.m * 60);
            }}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border cursor-pointer ${
              presetMins === p.m
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] border-transparent'
                : 'border-[#DADAD4] dark:border-[#2C303A] text-[#5A5D65] dark:text-[#9CA0AA]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="text-6xl sm:text-7xl font-bold font-mono tabular-nums tracking-tight text-[#111214] dark:text-[#F4F4F0]">
        {mins}:{secs}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          className="min-h-[48px] px-7 rounded-2xl bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          <span>{running ? 'Pause' : 'Start Focus'}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setRunning(false);
            setSecondsLeft(presetMins * 60);
          }}
          className="min-h-[48px] px-5 rounded-2xl border border-[#DADAD4] dark:border-[#2C303A] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset</span>
        </button>
      </div>

      <p className="text-xs font-mono tabular-nums text-[#6B707B] dark:text-[#9CA0AA]">
        Completed sessions today: {sessions}
      </p>
    </div>
  );
};

const SimpleCalculator: React.FC = () => {
  const [expr, setExpr] = useState('');
  const [display, setDisplay] = useState('0');

  const evaluateSafe = (raw: string): string => {
    const clean = raw.replace(/[^0-9+\-*/().% ]/g, '');
    if (!clean.trim()) return '0';
    try {
      const normalized = clean.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
      // Safe arithmetic parser using Function strictly on sanitized math characters
      const fn = new Function(`"use strict"; return (${normalized});`);
      const val = fn();
      if (typeof val === 'number' && Number.isFinite(val)) {
        return Number(val.toPrecision(12)).toString();
      }
      return 'Error';
    } catch {
      return 'Error';
    }
  };

  const press = (key: string) => {
    if (key === 'C') {
      setExpr('');
      setDisplay('0');
    } else if (key === '⌫') {
      const next = expr.slice(0, -1);
      setExpr(next);
      setDisplay(next || '0');
    } else if (key === '=') {
      const out = evaluateSafe(expr);
      setDisplay(out);
      setExpr(out === 'Error' ? '' : out);
    } else {
      const next = expr + key;
      setExpr(next);
      setDisplay(next);
    }
  };

  const keys = ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '%', '='];

  return (
    <div className="max-w-sm mx-auto rounded-3xl border border-[#E5E5E0] dark:border-[#242832] bg-white dark:bg-[#13151A] p-5 space-y-4">
      <div className="rounded-2xl bg-[#FAFAF8] dark:bg-[#0B0C0E] border border-[#E5E5E0] dark:border-[#242832] p-4 text-right">
        <div className="text-xs font-mono text-[#6B707B] h-4 truncate">{expr}</div>
        <div className="text-3xl font-bold font-mono tabular-nums truncate mt-1">{display}</div>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={`min-h-[52px] rounded-2xl text-base font-semibold font-mono transition-colors cursor-pointer ${
              k === '='
                ? 'bg-[#111214] dark:bg-[#D4AF37] text-white dark:text-[#0B0C0E]'
                : ['/', '*', '-', '+', 'C', '(', ')', '%'].includes(k)
                ? 'bg-[#F4F2EC] dark:bg-[#1C1F26] text-[#C9A227] dark:text-[#D4AF37]'
                : 'border border-[#E5E5E0] dark:border-[#242832] hover:bg-[#F5F5F1] dark:hover:bg-[#1A1D24]'
            }`}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => press('⌫')}
          className="col-span-4 min-h-[44px] rounded-2xl border border-[#E5E5E0] dark:border-[#242832] text-xs font-semibold text-[#5A5D65] dark:text-[#9CA0AA] cursor-pointer"
        >
          Backspace
        </button>
      </div>
    </div>
  );
};
