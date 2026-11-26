/** Installs a page-world observer without changing native Notification instances. */
export function installNotificationClickObserver(onTrustedClick: () => void): void {
    const NativeNotification = globalThis.Notification;
    if (typeof NativeNotification !== "function") return;

    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    const ObservedNotification = new Proxy(NativeNotification, {
        get(target, property): unknown {
            return Reflect.get(target, property, target);
        },
        construct(target, args, newTarget): Notification {
            const actualNewTarget = newTarget === ObservedNotification ? target : newTarget;
            const notification = Reflect.construct(target, args, actualNewTarget) as Notification;
            nativeAddEventListener.call(notification, "click", (event: Event) => {
                if (!event.isTrusted) return;
                onTrustedClick();
            });
            return notification;
        },
    });

    globalThis.Notification = ObservedNotification;
}
