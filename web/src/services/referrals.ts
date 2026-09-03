import { request } from './api';
import type {
  ReferralRecommendationRequest,
  ReferralRecommendationResponse,
  ReferralCreateRequest,
  ReferralCreateResponse,
} from '../types';

const BASE = '/api/v1/referrals';

/** POST /api/v1/referrals/recommend — rank capable referral facilities. */
export function recommendFacilities(
  data: ReferralRecommendationRequest,
): Promise<ReferralRecommendationResponse> {
  return request<ReferralRecommendationResponse>({ method: 'POST', url: `${BASE}/recommend`, data });
}

/** POST /api/v1/referrals/create — lock a selected referral destination. */
export function createReferral(data: ReferralCreateRequest): Promise<ReferralCreateResponse> {
  return request<ReferralCreateResponse>({ method: 'POST', url: `${BASE}/create`, data });
}