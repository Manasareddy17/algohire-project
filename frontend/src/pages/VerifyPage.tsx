import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDate } from '../api';

/** Public page, no login. The QR code on every certificate points here. */
export function VerifyPage() {
  const { certificateNo } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(certificateNo ?? '');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (!certificateNo) return;
    setResult(null);
    api(`/api/public/verify/${encodeURIComponent(certificateNo)}`).then(setResult).catch((err) =>
      setResult({ result: 'ERROR', message: err.message }),
    );
  }, [certificateNo]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (input.trim()) navigate(`/verify/${input.trim().toUpperCase()}`);
  }

  return (
    <section className="card verify">
      <h1>Verify a certificate</h1>
      <p className="muted">Enter the number printed on the certificate, e.g. PSM-2026-AB3CD5EF.</p>
      <form className="inline-form" onSubmit={submit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Certificate number" />
        <button type="submit">Check</button>
      </form>

      {result?.result === 'VALID' && (
        <div className="verdict valid">
          <h2>✔ Genuine certificate</h2>
          <dl>
            <dt>Number</dt><dd>{result.certificateNo}</dd>
            <dt>Candidate</dt><dd>{result.candidateName}</dd>
            <dt>Course</dt><dd>{result.courseName}</dd>
            <dt>Training centre</dt><dd>{result.centreName}</dd>
            <dt>Issued</dt><dd>{formatDate(result.issuedAt)}</dd>
          </dl>
        </div>
      )}
      {result?.result === 'REVOKED' && (
        <div className="verdict revoked">
          <h2>✖ This certificate is no longer valid</h2>
          <p>It was cancelled by the state office on {formatDate(result.revokedAt)}.</p>
        </div>
      )}
      {result?.result === 'NOT_FOUND' && (
        <div className="verdict revoked">
          <h2>✖ No certificate with this number exists</h2>
        </div>
      )}
      {result?.result === 'ERROR' && <p className="error">{result.message}</p>}
    </section>
  );
}
