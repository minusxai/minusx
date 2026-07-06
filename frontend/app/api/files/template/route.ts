import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { FileType } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files.server';
import { GetTemplateOptions } from '@/lib/data/types';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json();
    const { type, options = {} } = body as { type: FileType; options?: GetTemplateOptions };

    const template = await FilesAPI.getTemplate(type, options, user);
    return successResponse(template);
  } catch (error) {
    return handleApiError(error);
  }
});
