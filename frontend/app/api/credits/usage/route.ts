import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getCreditUsage, getConversationCredits } from '@/lib/analytics/credit-usage.server';

/**
 * GET /api/credits/usage — current calendar month credit usage.
 * Always returns the signed-in user's `individual` scope; `org` totals are
 * included only for admins (gated server-side — a non-admin can't obtain them).
 */
export const GET = withAuth(async (req: NextRequest, user) => {
  try {
    const data = await getCreditUsage(user.userId, user.role, isAdmin(user.role));
    // Optional per-conversation total for the /usage command — scoped to this user.
    const convoParam = req.nextUrl.searchParams.get('conversationId');
    const conversationId = convoParam != null ? Number(convoParam) : NaN;
    if (Number.isInteger(conversationId) && typeof user.userId === 'number') {
      data.conversation = { credits: await getConversationCredits(conversationId, user.userId) };
    }
    return await successResponse(data);
  } catch (error) {
    return handleApiError(error);
  }
});
