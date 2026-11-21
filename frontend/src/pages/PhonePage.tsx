import { FormEvent, useEffect, useState } from 'react';

/**
 * Demo only: shows what the mock WhatsApp provider delivered to a phone number,
 * so reviewers can see that each candidate got exactly one message.
 */
export function PhonePage() {
  const [phone, setPhone] = useState('+919876543210');
  const [messages, setMessages] = useState<any[] | null>(null);

  async function load(event?: FormEvent) {
    event?.preventDefault();
    const response = await fetch(`/whatsapp/v1/inbox/${encodeURIComponent(phone.trim())}`);
    setMessages(response.ok ? await response.json() : []);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card phone">
      <h1>Candidate phone (WhatsApp)</h1>
      <form className="inline-form" onSubmit={load}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91XXXXXXXXXX" />
        <button type="submit">Open inbox</button>
      </form>
      <div className="chat">
        {messages?.length === 0 && <p className="muted">No messages yet.</p>}
        {messages?.map((message) => (
          <div key={message.messageId} className="bubble">
            <p>{message.caption}</p>
            <a href={message.document.link} target="_blank" rel="noreferrer">📄 {message.document.filename}</a>
            <span className="muted">{new Date(message.receivedAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
      {messages && messages.length > 0 && <p className="muted">{messages.length} message(s) received.</p>}
    </section>
  );
}
