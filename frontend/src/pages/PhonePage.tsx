import { FormEvent, useEffect, useState } from 'react';

/** "98111 00002", "09811100002", "+91 9811100002" -> "+919811100002" (the format the system stores). */
function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${local}`;
}

/**
 * Demo only: shows what the mock WhatsApp provider delivered to a phone number,
 * so reviewers can see that each candidate got exactly one message.
 */
export function PhonePage() {
  const [input, setInput] = useState('');
  // The number whose inbox is open. Kept separate from the text box, so the auto-refresh
  // always reloads the inbox that was opened (it used to reload the default number).
  const [openPhone, setOpenPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[] | null>(null);

  useEffect(() => {
    if (!openPhone) return;
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`/whatsapp/v1/inbox/${encodeURIComponent(openPhone)}`);
      const data = response.ok ? await response.json() : [];
      if (!cancelled) setMessages(data);
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [openPhone]);

  function open(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setMessages(null);
    setOpenPhone(normalisePhone(input));
  }

  return (
    <section className="card phone">
      <h1>Candidate phone (WhatsApp)</h1>
      <p className="muted">Enter a candidate's mobile number, e.g. 9811100002.</p>
      <form className="inline-form" onSubmit={open}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Mobile number" />
        <button type="submit">Open inbox</button>
      </form>

      {openPhone && (
        <>
          <p className="muted">Inbox of <b>{openPhone}</b></p>
          <div className="chat">
            {messages?.length === 0 && <p className="muted">No messages for this number yet.</p>}
            {messages?.map((message) => (
              <div key={message.messageId} className="bubble">
                <p>{message.caption}</p>
                <a href={message.document.link} target="_blank" rel="noreferrer">📄 {message.document.filename}</a>
                <span className="muted">{new Date(message.receivedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
          {messages && messages.length > 0 && <p className="muted">{messages.length} message(s) received.</p>}
        </>
      )}
    </section>
  );
}
