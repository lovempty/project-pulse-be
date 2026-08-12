import { Type } from '@sinclair/typebox';

export const IdParams = Type.Object({ workspaceId: Type.String({ format: 'uuid' }) }, { additionalProperties: false });
export const PaginationQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 }))
}, { additionalProperties: false });
export const Id = Type.String({ format: 'uuid' });
export const NullableString = Type.Union([Type.String(), Type.Null()]);
export const success = <T extends ReturnType<typeof Type.Any>>(data: T) => Type.Object({
  data,
  meta: Type.Object({ requestId: Type.String() })
});

export const userPublic = Type.Object({
  id: Id, name: Type.String(), email: Type.String(), avatarUrl: NullableString,
  jobTitle: NullableString, createdAt: Type.String(), updatedAt: Type.String()
});
