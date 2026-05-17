import { z } from "zod";

export const NineRouterModelAliasesRequestSchema = z.object({
  type: z.literal("nine_router_model_aliases_request"),
  requestId: z.string(),
});

export const NineRouterSetModelAliasRequestSchema = z.object({
  type: z.literal("nine_router_set_model_alias_request"),
  requestId: z.string(),
  alias: z.string(),
  target: z.string(),
});

export const NineRouterDeleteModelAliasRequestSchema = z.object({
  type: z.literal("nine_router_delete_model_alias_request"),
  requestId: z.string(),
  alias: z.string(),
});

export const NineRouterTestModelRequestSchema = z.object({
  type: z.literal("nine_router_test_model_request"),
  requestId: z.string(),
  model: z.string(),
});

export const NineRouterModelAliasesResponseSchema = z.object({
  type: z.literal("nine_router_model_aliases_response"),
  payload: z.object({
    requestId: z.string(),
    aliases: z.record(z.string()),
  }),
});

export const NineRouterSetModelAliasResponseSchema = z.object({
  type: z.literal("nine_router_set_model_alias_response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
});

export const NineRouterDeleteModelAliasResponseSchema = z.object({
  type: z.literal("nine_router_delete_model_alias_response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
});

export const NineRouterTestModelResponseSchema = z.object({
  type: z.literal("nine_router_test_model_response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    latencyMs: z.number(),
    provider: z.string(),
  }),
});
