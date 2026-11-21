import { formatDate } from '../api';

interface Review {
  revision: number;
  stage: string;
  decision: 'APPROVE' | 'SEND_BACK' | 'REJECT';
  reason: string | null;
  reviewer: string;
  createdAt: string;
}

const STAGE_LABEL: Record<string, string> = { DISTRICT: 'District officer', QUALITY: 'Quality team', STATE: 'State office' };

/**
 * Tells the centre clearly why a batch was rejected or sent back, who decided, when,
 * and what to do next. Built from the batch's reviews of its current revision.
 */
export function DecisionBanner({ batch, isOwner }: { batch: { status: string; revision: number; reviews: Review[] }; isOwner: boolean }) {
  const decision = batch.status === 'REJECTED' ? 'REJECT' : batch.status === 'SENT_BACK' ? 'SEND_BACK' : null;
  if (!decision) return null;

  const decisions = batch.reviews.filter((review) => review.revision === batch.revision && review.decision === decision);
  const rejected = decision === 'REJECT';

  return (
    <div className={`banner ${rejected ? 'banner-rejected' : 'banner-sent-back'}`}>
      <h3>{rejected ? '✖ This batch was rejected' : '↩ This batch was sent back for corrections'}</h3>
      <ul>
        {decisions.map((review, index) => (
          <li key={index}>
            <b>{review.reviewer}</b> ({STAGE_LABEL[review.stage] ?? review.stage}) · {formatDate(review.createdAt)}
            <div>Reason: “{review.reason}”</div>
          </li>
        ))}
      </ul>
      {isOwner && (
        <p className="banner-next">
          {rejected
            ? 'Next step: this batch is closed. If these candidates should still be certified, create a new batch and upload them again.'
            : 'Next step: fix the spreadsheet, upload it again below and click “Resubmit for approval”. All reviewers will check it again.'}
        </p>
      )}
    </div>
  );
}
