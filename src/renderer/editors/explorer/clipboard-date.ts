const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export interface ClipboardTimeLabel {
    badge: string;
    tooltip: string;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function timeText(date: Date): string {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localMidnight(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function clipboardTimeLabel(capturedAt: number, now = new Date()): ClipboardTimeLabel {
    const capturedDate = new Date(capturedAt);
    const time = timeText(capturedDate);
    const today = localMidnight(now);
    const capturedDay = localMidnight(capturedDate);
    const dayDifference = Math.max(0, Math.round((today - capturedDay) / (MINUTES_PER_DAY * 60 * 1000)));

    if (dayDifference === 0) {
        return { badge: time, tooltip: `Today at ${time}` };
    }

    return {
        badge: `-${dayDifference}d ${time}`,
        tooltip: dayDifference === 1 ? "1 day ago" : `${dayDifference} days ago`,
    };
}
