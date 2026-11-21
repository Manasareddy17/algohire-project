import { BatchStatus, ReviewDecision, ReviewStage, Role } from '@prisma/client';
import { ForbiddenException } from '../../core/exceptions';
import { UserResponse } from '../../core/interfaces/user.interface';
import { BatchScope, BatchWorkflowService } from './batch-workflow.service';

describe('BatchWorkflowService', () => {
  const service = new BatchWorkflowService({ districtApprovalsRequired: 2, qualityReviewThreshold: 50 });

  const user = (role: Role, extra: Partial<UserResponse> = {}): UserResponse => ({
    id: 1,
    username: 'u',
    name: 'U',
    role,
    districtId: null,
    centreId: null,
    ...extra,
  });
  const batch = (status: BatchStatus = BatchStatus.DISTRICT_REVIEW): BatchScope => ({
    status,
    centreId: 10,
    centre: { districtId: 100 },
  });

  describe('stageForStatus', () => {
    it.each([
      [BatchStatus.DISTRICT_REVIEW, ReviewStage.DISTRICT],
      [BatchStatus.QUALITY_REVIEW, ReviewStage.QUALITY],
      [BatchStatus.STATE_REVIEW, ReviewStage.STATE],
    ])('maps %s to the %s stage', (status, stage) => {
      expect(service.stageForStatus(status)).toBe(stage);
    });

    it.each([BatchStatus.DRAFT, BatchStatus.SENT_BACK, BatchStatus.APPROVED, BatchStatus.REJECTED])(
      'returns null for %s because nobody reviews it',
      (status) => {
        expect(service.stageForStatus(status)).toBeNull();
      },
    );
  });

  describe('stageForRole', () => {
    it.each([
      [Role.DISTRICT_OFFICER, ReviewStage.DISTRICT],
      [Role.QUALITY, ReviewStage.QUALITY],
      [Role.STATE, ReviewStage.STATE],
      [Role.CENTRE, null],
    ])('maps the %s role to %s', (role, stage) => {
      expect(service.stageForRole(role)).toBe(stage);
    });
  });

  describe('hasStagePassedFor', () => {
    it.each([
      [Role.DISTRICT_OFFICER, ReviewStage.STATE, true],
      [Role.DISTRICT_OFFICER, ReviewStage.QUALITY, true],
      [Role.DISTRICT_OFFICER, ReviewStage.DISTRICT, false],
      [Role.QUALITY, ReviewStage.DISTRICT, false],
      [Role.STATE, ReviewStage.DISTRICT, false],
      [Role.CENTRE, ReviewStage.STATE, false],
    ])('returns %s at the %s stage -> %s', (role, stage, expected) => {
      expect(service.hasStagePassedFor(role, stage)).toBe(expected);
    });
  });

  describe('decisionsRequired', () => {
    it('requires the configured quorum at the district stage', () => {
      expect(service.decisionsRequired(ReviewStage.DISTRICT)).toBe(2);
    });

    it.each([ReviewStage.QUALITY, ReviewStage.STATE])('requires a single decision at the %s stage', (stage) => {
      expect(service.decisionsRequired(stage)).toBe(1);
    });
  });

  describe('isImmediate', () => {
    it.each([
      [ReviewDecision.SEND_BACK, true],
      [ReviewDecision.APPROVE, false],
      [ReviewDecision.REJECT, false],
    ])('treats %s as immediate: %s', (decision, expected) => {
      expect(service.isImmediate(decision)).toBe(expected);
    });
  });

  describe('statusAfterApproval', () => {
    it.each([
      [1, BatchStatus.STATE_REVIEW],
      [50, BatchStatus.STATE_REVIEW],
      [51, BatchStatus.QUALITY_REVIEW],
    ])('sends a district-approved batch of %i candidates to %s', (count, expected) => {
      expect(service.statusAfterApproval(ReviewStage.DISTRICT, count)).toBe(expected);
    });

    it('sends a quality-approved batch to the state office', () => {
      expect(service.statusAfterApproval(ReviewStage.QUALITY, 500)).toBe(BatchStatus.STATE_REVIEW);
    });

    it('approves the batch after the state office approves', () => {
      expect(service.statusAfterApproval(ReviewStage.STATE, 5)).toBe(BatchStatus.APPROVED);
    });
  });

  describe('statusAfterDecision', () => {
    it.each([ReviewStage.DISTRICT, ReviewStage.QUALITY, ReviewStage.STATE])(
      'returns SENT_BACK for a send back at the %s stage',
      (stage) => {
        expect(service.statusAfterDecision(stage, ReviewDecision.SEND_BACK, 5)).toBe(BatchStatus.SENT_BACK);
      },
    );

    it('returns REJECTED for a reject', () => {
      expect(service.statusAfterDecision(ReviewStage.STATE, ReviewDecision.REJECT, 5)).toBe(BatchStatus.REJECTED);
    });

    it('follows the approval path for an approve', () => {
      expect(service.statusAfterDecision(ReviewStage.DISTRICT, ReviewDecision.APPROVE, 60)).toBe(
        BatchStatus.QUALITY_REVIEW,
      );
    });
  });

  describe('assertCanReview', () => {
    it('lets an officer of the batch district act at the district stage', () => {
      expect(() =>
        service.assertCanReview(user(Role.DISTRICT_OFFICER, { districtId: 100 }), batch(), ReviewStage.DISTRICT),
      ).not.toThrow();
    });

    it('blocks an officer from another district', () => {
      expect(() =>
        service.assertCanReview(user(Role.DISTRICT_OFFICER, { districtId: 999 }), batch(), ReviewStage.DISTRICT),
      ).toThrow(new ForbiddenException('This batch belongs to a different district'));
    });

    it.each([
      [Role.CENTRE, ReviewStage.DISTRICT, 'DISTRICT_OFFICER'],
      [Role.STATE, ReviewStage.DISTRICT, 'DISTRICT_OFFICER'],
      [Role.DISTRICT_OFFICER, ReviewStage.QUALITY, 'QUALITY'],
      [Role.QUALITY, ReviewStage.STATE, 'STATE'],
    ])('blocks a %s user at the %s stage', (role, stage, expectedRole) => {
      expect(() => service.assertCanReview(user(role, { districtId: 100 }), batch(), stage)).toThrow(
        new ForbiddenException(`Only ${expectedRole} users can act at the ${stage} stage`),
      );
    });

    it.each([
      [Role.QUALITY, ReviewStage.QUALITY],
      [Role.STATE, ReviewStage.STATE],
    ])('lets a %s user act on any district at the %s stage', (role, stage) => {
      expect(() => service.assertCanReview(user(role), batch(), stage)).not.toThrow();
    });
  });

  describe('assertCentreOwnsBatch', () => {
    it('lets the owning centre act', () => {
      expect(() => service.assertCentreOwnsBatch(user(Role.CENTRE, { centreId: 10 }), batch())).not.toThrow();
    });

    it.each([
      ['another centre', user(Role.CENTRE, { centreId: 11 })],
      ['a district officer', user(Role.DISTRICT_OFFICER, { districtId: 100 })],
      ['the state office', user(Role.STATE)],
    ])('blocks %s', (_label, actor) => {
      expect(() => service.assertCentreOwnsBatch(actor, batch())).toThrow(ForbiddenException);
    });
  });

  describe('canView', () => {
    it.each([
      ['the owning centre', user(Role.CENTRE, { centreId: 10 }), true],
      ['another centre', user(Role.CENTRE, { centreId: 11 }), false],
      ['an officer of the district', user(Role.DISTRICT_OFFICER, { districtId: 100 }), true],
      ['an officer of another district', user(Role.DISTRICT_OFFICER, { districtId: 200 }), false],
      ['the quality team', user(Role.QUALITY), true],
      ['the state office', user(Role.STATE), true],
    ])('returns the right answer for %s', (_label, viewer, expected) => {
      expect(service.canView(viewer, batch())).toBe(expected);
    });
  });
});
