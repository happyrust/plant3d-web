import type { UserDimensionRecord } from './types';

export type DimensionUser = Readonly<{
  id: string;
  role: string;
}>;

export function canEditUserDimension(
  user: DimensionUser | null,
  record: UserDimensionRecord,
): boolean {
  return !!user
    && (user.id === record.authorId || user.role.toLowerCase() === 'admin');
}
