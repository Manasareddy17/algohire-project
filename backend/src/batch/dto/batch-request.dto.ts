import { z } from 'zod';
import { BatchStatus, ReviewDecision } from '../enums';

// Request bodies are validated with zod before they reach a command handler.

export const createBatchSchema = z.object({
  courseCode: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/, 'Course code must be 2-20 uppercase letters, digits or "-"'),
  courseName: z.string().trim().min(3).max(120),
});
export type CreateBatchDto = z.infer<typeof createBatchSchema>;

export const reviewBatchSchema = z
  .object({
    decision: z.nativeEnum(ReviewDecision),
    reason: z.string().trim().max(500).optional(),
    // The revision the officer was looking at. If the centre changed the batch since, we refuse.
    revision: z.number().int().positive(),
  })
  .refine((body) => body.decision === ReviewDecision.APPROVE || (body.reason && body.reason.length >= 5), {
    message: 'A reason of at least 5 characters is required to send back or reject',
    path: ['reason'],
  });
export type ReviewBatchDto = z.infer<typeof reviewBatchSchema>;

export const fetchBatchesSchema = z.object({
  status: z.nativeEnum(BatchStatus).optional(),
});
export type FetchBatchesDto = z.infer<typeof fetchBatchesSchema>;
