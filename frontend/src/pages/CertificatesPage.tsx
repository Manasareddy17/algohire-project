import { useEffect, useState } from 'react';
import { api, ApiError, formatDate, post, User } from '../api';

export function CertificatesPage({ user, version }: { user: User; version: number }) {
  const [search, setSearch] = useState('');
  const [certificates, setCertificates] = useState<any[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      api(`/api/certificates?search=${encodeURIComponent(search)}`).then(setCertificates);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, version]);

  async function revoke(certificate: any) {
    const reason = window.prompt(`Why is ${certificate.certificateNo} being cancelled?`);
    if (!reason) return;
    try {
      const result = await post(`/api/certificates/${certificate.id}/revoke`, { reason });
      setMessage(result.message);
      setCertificates(await api(`/api/certificates?search=${encodeURIComponent(search)}`));
    } catch (err) {
      setMessage((err as ApiError).message);
    }
  }

  return (
    <section className="card">
      <h2>Certificates</h2>
      <input
        className="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by certificate number, name or enrolment ID"
      />
      {message && <p className="success">{message}</p>}
      <table>
        <thead>
          <tr>
            <th>Number</th><th>Candidate</th><th>Course</th><th>Phone</th><th>Issued</th><th>Status</th><th>WhatsApp</th>
            {user.role === 'STATE' && <th />}
          </tr>
        </thead>
        <tbody>
          {certificates.map((certificate) => (
            <tr key={certificate.id}>
              <td><a href={`/verify/${certificate.certificateNo}`}>{certificate.certificateNo}</a></td>
              <td>{certificate.candidateName}</td>
              <td>{certificate.courseName}</td>
              <td>{certificate.phone}</td>
              <td className="muted">{formatDate(certificate.issuedAt)}</td>
              <td><span className={`status status-${certificate.status}`}>{certificate.status}</span></td>
              <td><span className={`status status-${certificate.deliveryStatus}`}>{certificate.deliveryStatus}</span></td>
              {user.role === 'STATE' && (
                <td>
                  {certificate.status === 'ISSUED' && (
                    <button className="danger small" onClick={() => revoke(certificate)}>Cancel</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
