import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, formatDate, post, STATUS_LABEL, User } from '../api';

const STAGE_ROLE: Record<string, User['role']> = { DISTRICT: 'DISTRICT_OFFICER', QUALITY: 'QUALITY', STATE: 'STATE' };

export function BatchDetailPage({ user, version }: { user: User; version: number }) {
  const { id } = useParams();
  const [batch, setBatch] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<{ row: number; column: string; message: string }[]>([]);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setBatch(await api(`/api/batches/${id}`));
      setTimeline(await api(`/api/batches/${id}/timeline`));
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, version]);

  async function run(action: () => Promise<{ message: string }>) {
    setMessage(null);
    setRowErrors([]);
    try {
      const result = await action();
      setMessage({ kind: 'ok', text: result.message });
      setReason('');
      await load();
    } catch (err) {
      const apiError = err as ApiError;
      setMessage({ kind: 'error', text: apiError.message });
      setRowErrors((apiError.body?.errors as any[]) ?? []);
    }
  }

  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    await run(() => post(`/api/batches/${id}/candidates`, form));
  }

  if (!batch) return <section className="card">{message?.text ?? 'Loading…'}</section>;

  const isOwner = user.role === 'CENTRE';
  const editable = isOwner && ['DRAFT', 'SENT_BACK'].includes(batch.status);
  const myStageActive = batch.stage && STAGE_ROLE[batch.stage] === user.role;
  const alreadyReviewed = batch.reviews.some(
    (review: any) => review.reviewerId === user.id && review.revision === batch.revision && review.stage === batch.stage,
  );
  const currentApprovals = batch.reviews.filter(
    (review: any) => review.revision === batch.revision && review.stage === batch.stage && review.decision === 'APPROVE',
  ).length;

  return (
    <>
      <section className="card">
        <div className="title-row">
          <h1>{batch.code}</h1>
          <span className={`status status-${batch.status}`}>{STATUS_LABEL[batch.status]}</span>
          {batch.escalatedAt && <span className="status status-escalated">Escalated</span>}
        </div>
        <p className="muted">
          {batch.courseName} ({batch.courseCode}) · {batch.centre.name}, {batch.centre.district.name} · revision{' '}
          {batch.revision} · {batch.candidates.length} candidates
        </p>
        {batch.status === 'SENT_BACK' && <p className="warning-text">Sent back: {batch.sendBackReason}</p>}
        {batch.stage && (
          <p>
            Waiting for <b>{batch.stage.toLowerCase()}</b> review · approvals this revision: {currentApprovals} /{' '}
            {batch.decisionsRequired}
          </p>
        )}

        {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
        {rowErrors.length > 0 && (
          <p className="muted">
            {rowErrors.length} problem(s) found. Fix these rows in your spreadsheet and upload it again
            (row numbers match Excel, header = row 1).
          </p>
        )}
        {rowErrors.length > 0 && (
          <table className="errors">
            <thead>
              <tr><th>Row</th><th>Column</th><th>Problem</th></tr>
            </thead>
            <tbody>
              {rowErrors.map((error, index) => (
                <tr key={index}>
                  <td>{error.row ?? '—'}</td>
                  <td>{error.column ?? (error as any).field}</td>
                  <td>{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editable && (
          <div className="actions">
            <label className="file-button">
              Upload spreadsheet (.csv / .xlsx)
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // so picking the same (fixed) file again uploads again
                  if (file) upload(file);
                }}
              />
            </label>
            <button disabled={batch.candidates.length === 0} onClick={() => run(() => post(`/api/batches/${id}/submit`))}>
              {batch.status === 'SENT_BACK' ? 'Resubmit for approval' : 'Submit for approval'}
            </button>
          </div>
        )}

        {myStageActive && !alreadyReviewed && (
          <div className="actions">
            <input
              className="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required to send back or reject)"
            />
            <button onClick={() => run(() => post(`/api/batches/${id}/reviews`, { decision: 'APPROVE', revision: batch.revision }))}>
              Approve
            </button>
            <button className="secondary" onClick={() => run(() => post(`/api/batches/${id}/reviews`, { decision: 'SEND_BACK', reason, revision: batch.revision }))}>
              Send back
            </button>
            <button className="danger" onClick={() => run(() => post(`/api/batches/${id}/reviews`, { decision: 'REJECT', reason, revision: batch.revision }))}>
              Reject
            </button>
          </div>
        )}
        {myStageActive && alreadyReviewed && <p className="muted">You have reviewed this revision.</p>}
      </section>

      {batch.certificates.length > 0 && (
        <section className="card">
          <h2>Certificates</h2>
          <table>
            <thead>
              <tr><th>Number</th><th>Candidate</th><th>Status</th><th>WhatsApp</th><th>Attempts</th></tr>
            </thead>
            <tbody>
              {batch.certificates.map((certificate: any) => (
                <tr key={certificate.id}>
                  <td><a href={`/verify/${certificate.certificateNo}`}>{certificate.certificateNo}</a></td>
                  <td>{certificate.candidateName}</td>
                  <td><span className={`status status-${certificate.status}`}>{certificate.status}</span></td>
                  <td>
                    <span className={`status status-${certificate.deliveryStatus}`}>{certificate.deliveryStatus}</span>
                    {certificate.lastDeliveryError && certificate.deliveryStatus !== 'SENT' && (
                      <span className="muted"> {certificate.lastDeliveryError}</span>
                    )}
                  </td>
                  <td>{certificate.deliveryAttempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="two-columns">
        <section className="card">
          <h2>Candidates</h2>
          <table>
            <thead>
              <tr><th>Row</th><th>Enrolment</th><th>Name</th><th>Phone</th><th>Score</th></tr>
            </thead>
            <tbody>
              {batch.candidates.map((candidate: any) => (
                <tr key={candidate.id}>
                  <td>{candidate.rowNumber}</td>
                  <td>{candidate.enrolmentId}</td>
                  <td>{candidate.name}</td>
                  <td>{candidate.phone}</td>
                  <td>{candidate.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2>History (who did what, when)</h2>
          <ol className="timeline">
            {timeline.map((entry) => (
              <li key={entry.id}>
                <b>{entry.action.replaceAll('_', ' ').toLowerCase()}</b> by {entry.actor}
                <span className="muted"> · {formatDate(entry.createdAt)}</span>
                {entry.metadata?.decision && <div className="muted">{entry.metadata.stage}: {entry.metadata.decision} {entry.metadata.reason ? `— ${entry.metadata.reason}` : ''}</div>}
                {entry.metadata?.to && <div className="muted">{entry.metadata.from} → {entry.metadata.to}</div>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
