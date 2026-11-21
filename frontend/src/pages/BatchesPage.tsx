import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, formatDate, post, STATUS_LABEL, User } from '../api';

interface BatchRow {
  id: string;
  code: string;
  courseName: string;
  status: string;
  revision: number;
  updatedAt: string;
  escalatedAt: string | null;
  waitingMinutes?: number;
  centre: { name: string; district: { name: string } };
  _count: { candidates: number; certificates: number };
}

export function BatchesPage({ user, version }: { user: User; version: number }) {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [pending, setPending] = useState<BatchRow[]>([]);
  const [stuck, setStuck] = useState<BatchRow[]>([]);

  useEffect(() => {
    api<BatchRow[]>('/api/batches').then(setBatches);
    if (user.role !== 'CENTRE') api<BatchRow[]>('/api/batches/pending-reviews').then(setPending);
    if (user.role === 'STATE') api<BatchRow[]>('/api/batches/stuck').then(setStuck);
  }, [user, version]);

  return (
    <>
      {user.role === 'CENTRE' && <CreateBatch />}
      {user.role === 'STATE' && stuck.length > 0 && (
        <BatchTable title={`Stuck batches (${stuck.length})`} rows={stuck} highlight="warning" />
      )}
      {user.role !== 'CENTRE' && (
        <BatchTable title={`Waiting for you (${pending.length})`} rows={pending} empty="Nothing is waiting for you." />
      )}
      <BatchTable title="All batches you can see" rows={batches} empty="No batches yet." />
    </>
  );
}

function CreateBatch() {
  const navigate = useNavigate();
  const [courseCode, setCourseCode] = useState('ELEC-101');
  const [courseName, setCourseName] = useState('Assistant Electrician');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const created = await post<{ id: string }>('/api/batches', { courseCode, courseName });
      navigate(`/batches/${created.id}`);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <section className="card">
      <h2>New batch</h2>
      <form className="inline-form" onSubmit={submit}>
        <input value={courseCode} onChange={(e) => setCourseCode(e.target.value.toUpperCase())} placeholder="Course code" />
        <input value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="Course name" />
        <button type="submit">Create batch</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function BatchTable({ title, rows, empty, highlight }: { title: string; rows: BatchRow[]; empty?: string; highlight?: string }) {
  return (
    <section className={`card ${highlight ?? ''}`}>
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Course</th>
              <th>Centre</th>
              <th>Candidates</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((batch) => (
              <tr key={batch.id}>
                <td>
                  <Link to={`/batches/${batch.id}`}>{batch.code}</Link>
                  {batch.revision > 1 && <span className="muted"> · rev {batch.revision}</span>}
                </td>
                <td>{batch.courseName}</td>
                <td>{batch.centre.name} <span className="muted">({batch.centre.district.name})</span></td>
                <td>{batch._count.candidates}</td>
                <td>
                  <span className={`status status-${batch.status}`}>{STATUS_LABEL[batch.status]}</span>
                  {batch.escalatedAt && <span className="status status-escalated">Escalated</span>}
                  {batch.waitingMinutes !== undefined && <span className="muted"> {batch.waitingMinutes} min</span>}
                </td>
                <td className="muted">{formatDate(batch.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
