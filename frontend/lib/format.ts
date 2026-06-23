export function formatMessageTime(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatChatListTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return formatMessageTime(isoDate);
  }

  const isThisWeek = now.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (isThisWeek) {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
