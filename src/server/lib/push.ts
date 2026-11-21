export function createPushService({
  webpush,
  listPushSubscriptionsByUserIds,
  deletePushSubscription,
  getTotalUnreadCount,
  vapid,
  proxyUrl,
}: any) {
  const VAPID_PUBLIC_KEY: any = String(vapid.publicKey || "").trim();
  const VAPID_PRIVATE_KEY: any = String(vapid.privateKey || "").trim();
  const VAPID_SUBJECT: any = String(
    vapid.subject || "mailto:admin@example.com",
  ).trim();
  const PUSH_ENABLED: any = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  
  let proxyAgent: any = null;

  if (PUSH_ENABLED) {
    try {
      webpush.setVapidDetails(
        VAPID_SUBJECT,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY,
      );
      
      // Configure proxy if provided
      if (proxyUrl) {
        import('https-proxy-agent').then(({ HttpsProxyAgent }: any) => {
          proxyAgent = new HttpsProxyAgent(proxyUrl);
          console.log(`[push] Using proxy: ${proxyUrl}`);
        }).catch((error) => {
          console.error(
            "[push] Failed to configure proxy:",
            String(error?.message || error),
          );
        });
      }
    } catch (error) {
      console.error(
        "[push] VAPID setup failed:",
        String(error?.message || error),
      );
    }
  }

  async function sendPushNotificationToUsers(userIds: any = [], payload: any = {}) {
    if (!PUSH_ENABLED) return;
    const rawTargets: any = listPushSubscriptionsByUserIds(userIds);
    const targets = (rawTargets && typeof rawTargets.then === "function" ? await rawTargets : rawTargets) || [];
    if (!targets.length) return;

    const badgeByUserId: any = {};
    for (const sub of targets) {
      const uid = sub.user_id;
      if (!(uid in badgeByUserId)) {
        try {
          const rawCount = getTotalUnreadCount
            ? getTotalUnreadCount(uid)
            : 1;
          badgeByUserId[uid] =
            rawCount && typeof rawCount.then === "function"
              ? await rawCount
              : rawCount;
        } catch {
          badgeByUserId[uid] = 1;
        }
      }
    }

    await Promise.all(
      targets.map(async (sub) => {
        const badge = badgeByUserId[sub.user_id] ?? 1;
        const showPreview = sub.message_preview !== 0;
        const perUserPayload = showPreview
          ? { ...payload, badge }
          : { ...payload, body: "New message", badge };
        const perUserBody: any = JSON.stringify(perUserPayload);
        try {
          const sendOptions: any = { urgency: "high", TTL: 86400 };
          if (proxyAgent) sendOptions.agent = proxyAgent;
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh || "",
                auth: sub.auth || "",
              },
            },
            perUserBody,
            sendOptions,
          );
        } catch (error) {
          const status: any = Number(error?.statusCode || 0);
          const errBody: any = String(error?.body || "");
          
          const isGone =
            status === 404 ||
            status === 410 ||
            status === 401 ||
            status === 403 ||
            (status === 400 && errBody.includes("VapidPkHashMismatch"));
          if (isGone) {
            console.info(
              `[push] Pruned stale subscription endpoint=${sub.endpoint.slice(-24)} (status=${status})`,
            );
            try {
              const res: any = deletePushSubscription(sub.endpoint);
              if (res && typeof res.then === "function") await res;
            } catch {}
          } else {
            // Log detailed error information for debugging
            let errorDetails: any = String(error?.message || error).slice(0, 120);
            if (error?.errors && Array.isArray(error.errors)) {
              // AggregateError contains multiple errors
              errorDetails = error.errors.map(e => String(e?.message || e)).join('; ').slice(0, 200);
            }

            console.warn(
              `[push] delivery failed endpoint=${sub.endpoint.slice(-24)} status=${status} body=${errBody.slice(0, 200)} err=${errorDetails}`,
            );
          }
        }
      }),
    );
  }

  return {
    PUSH_ENABLED,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
    sendPushNotificationToUsers,
  };
}
