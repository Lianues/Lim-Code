/**
 * Review 工具模块
 */

import type { Tool, ToolRegistration } from '../types';

export { registerCreateReview } from './create_review';
export { registerRecordReviewMilestone } from './record_review_milestone';
export { registerFinalizeReview } from './finalize_review';
export { registerValidateReviewDocument } from './validate_review_document';
export { registerReopenReview } from './reopen_review';
export { registerCompareReviewDocuments } from './compare_review_documents';

export function getReviewToolRegistrations(): ToolRegistration[] {
  const { registerCreateReview } = require('./create_review');
  const { registerRecordReviewMilestone } = require('./record_review_milestone');
  const { registerFinalizeReview } = require('./finalize_review');
  const { registerValidateReviewDocument } = require('./validate_review_document');
  const { registerReopenReview } = require('./reopen_review');
  const { registerCompareReviewDocuments } = require('./compare_review_documents');
  return [registerCreateReview, registerRecordReviewMilestone, registerFinalizeReview, registerValidateReviewDocument, registerReopenReview, registerCompareReviewDocuments];
}

export function getAllReviewTools(): Tool[] {
  const { registerCreateReview } = require('./create_review');
  const { registerRecordReviewMilestone } = require('./record_review_milestone');
  const { registerFinalizeReview } = require('./finalize_review');
  const { registerValidateReviewDocument } = require('./validate_review_document');
  const { registerReopenReview } = require('./reopen_review');
  const { registerCompareReviewDocuments } = require('./compare_review_documents');
  return [registerCreateReview(), registerRecordReviewMilestone(), registerFinalizeReview(), registerValidateReviewDocument(), registerReopenReview(), registerCompareReviewDocuments()];
}
