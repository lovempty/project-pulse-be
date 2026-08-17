import type { PrismaClient } from '@prisma/client';
import { classifyAiRequest } from './classifier.js';
import { createConversationalResult } from './conversation.js';
import { buildAiContext } from './context.service.js';
import { askAssistant } from './service.js';
import type { AiInteractionType, AiRequest, AiResult } from './types.js';

export type AiOrchestration = { interactionType: AiInteractionType; result: AiResult };

export async function runAiRequest(prisma: PrismaClient, workspaceId: string, request: AiRequest): Promise<AiOrchestration> {
  const interactionType = classifyAiRequest(request);
  if (interactionType !== 'ANALYSIS') return { interactionType, result: createConversationalResult(interactionType) };
  const context = await buildAiContext(prisma, workspaceId, request.projectId);
  return { interactionType, result: await askAssistant(request, context) };
}
