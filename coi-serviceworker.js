/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === "undefined") {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then((clients) => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request =
            coepCredentialless && r.mode === "no-cors"
                ? new Request(r, {
                      credentials: "omit",
                  })
                : r;
        // [whistle 수정] 받기가 실패하면 한 번 더 받는다. 그래도 실패하면 이유를 페이지 콘솔에 보낸다.
        // (폰 Firefox에서 pd4web 작업자 4개의 스크립트 요청이 여기서 실패해 엔진이 멈췄다.)
        const forward = (req) => fetch(req)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set(
                        "Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp",
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                    }
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                });
        event.respondWith(
            forward(request)
                // 두 번째는 원래 요청(작업자 요청의 mode·destination 등)을 복사하지 않고 주소만으로 받는다.
                .catch((first) => {
                    console.error(first);
                    return forward(new Request(r.url, { credentials: "same-origin" }));
                })
                .catch((e) => {
                    console.error(e);
                    const message = `coi-serviceworker: ${r.destination || "?"} ${r.mode} ${r.url} 받기 실패: ${e && e.name}: ${e && e.message}`;
                    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => clients.forEach((c) => c.postMessage({ type: "coiFetchError", message })));
                    throw e;
                }),
        );
    });
} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = reloadedBySelf == "coepdegrade";

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => true,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi,
        };

        const n = navigator;
        // [whistle 수정] 서비스 워커에서 받기가 실패한 이유를 페이지 콘솔에 남긴다.
        n.serviceWorker && n.serviceWorker.addEventListener("message", (ev) => {
            if (ev.data && ev.data.type === "coiFetchError") console.error(ev.data.message);
        });
        // addEventListener만으로는 메시지가 오지 않는다(onmessage를 쓰거나 startMessages()를 불러야 한다).
        n.serviceWorker && n.serviceWorker.startMessages();
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(coepDegrading || window.crossOriginIsolated);
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: reloadToDegrade || (coepHasFailed && coi.coepDegrade()) ? false : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            },
        );
    })();
}
