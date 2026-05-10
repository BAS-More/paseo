import { describe, expect, it } from "vitest";

// getDateBucket is a private function in left-sidebar.tsx.
// Replicate the logic here for unit-testability.
// If it's ever extracted to a shared util, swap the import.
type DateBucket = "today" | "yesterday" | "this-week" | "this-month" | "older";

function getDateBucket(activityAt: string | null): DateBucket {
  if (!activityAt) return "older";
  const date = new Date(activityAt);
  if (isNaN(date.getTime())) return "older";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0 && date.toDateString() === now.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "yesterday";
  if (diffDays < 7) return "this-week";
  if (diffDays < 30) return "this-month";
  return "older";
}

describe("getDateBucket", () => {
  it("returns 'today' for a timestamp from today", () => {
    const now = new Date();
    expect(getDateBucket(now.toISOString())).toBe("today");
  });

  it("returns 'yesterday' for a timestamp from yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    expect(getDateBucket(yesterday.toISOString())).toBe("yesterday");
  });

  it("returns 'this-week' for 3 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(12, 0, 0, 0);
    expect(getDateBucket(d.toISOString())).toBe("this-week");
  });

  it("returns 'this-month' for 14 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    expect(getDateBucket(d.toISOString())).toBe("this-month");
  });

  it("returns 'older' for 60 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 60);
    expect(getDateBucket(d.toISOString())).toBe("older");
  });

  it("returns 'older' for null", () => {
    expect(getDateBucket(null)).toBe("older");
  });

  it("returns 'older' for invalid date string", () => {
    expect(getDateBucket("not-a-date")).toBe("older");
  });

  it("returns 'older' for empty string", () => {
    expect(getDateBucket("")).toBe("older");
  });
});
