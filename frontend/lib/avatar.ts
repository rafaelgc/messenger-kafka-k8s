const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

export function avatarColorFromNickname(nickname: string): string {
  const normalized = nickname.trim().toLowerCase();
  const colorIndex = hashString(normalized) % AVATAR_COLORS.length;
  return AVATAR_COLORS[colorIndex]!;
}
