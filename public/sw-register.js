self.addEventListener("load", function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(function (err) {
    console.error("SW registration failed:", err);
  });
});
