function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value ?? "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e";
  }
}

function getDaemonProcessText(status) {
  if (status?.connectedProcessLabel) {
    return status.connectedProcessLabel;
  }

  if (status?.daemonPid) {
    return `daemon:${status.daemonPid}`;
  }

  return "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e";
}

const searchParams = new URLSearchParams(location.search);
if (searchParams.get("reloadUmb") === "1") {
  chrome.runtime.reload();
}

chrome.runtime.sendMessage({ type: "umb:get-status" }, (status) => {
  const dot = document.getElementById("dot");
  const summary = document.getElementById("summary");
  const connected = Boolean(status?.connected);
  const sessionActive = Boolean(status?.sessionActive);

  if (connected) {
    dot?.classList.add("ok");
  } else {
    dot?.classList.remove("ok");
  }

  if (summary) {
    if (!connected) {
      summary.textContent = "\u041c\u043e\u0441\u0442 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d";
    } else if (sessionActive) {
      summary.textContent = `\u041e\u0442\u043b\u0430\u0434\u043a\u0430 \u0430\u043a\u0442\u0438\u0432\u043d\u0430: ${status?.sessionName ?? status?.sessionId ?? "\u0431\u0435\u0437 \u0438\u043c\u0435\u043d\u0438"}`;
    } else {
      summary.textContent = "\u041c\u043e\u0441\u0442 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d, \u0441\u0435\u0441\u0441\u0438\u044f \u043d\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u0430";
    }
  }

  setText("sessionState", sessionActive ? "\u0410\u043a\u0442\u0438\u0432\u043d\u0430" : connected ? "\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435" : "\u041d\u0435\u0442 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u044f");
  setText("sessionName", status?.sessionName ?? "\u041d\u0435\u0442");
  setText("daemonPid", getDaemonProcessText(status));
  setText(
    "debuggerSessions",
    typeof status?.activeDebuggerSessions === "number"
      ? String(status.activeDebuggerSessions)
      : "0"
  );
  setText(
    "attachedTabs",
    typeof status?.attachedTabCount === "number" ? String(status.attachedTabCount) : "0"
  );
  setText("nativePid", status?.nativeHostPid ? String(status.nativeHostPid) : "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e");
  setText("wsUrl", status?.wsUrl ?? "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e");
  setText("httpUrl", status?.daemonHttpUrl ?? "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e");
  setText("hostName", status?.hostName ?? "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e");
  setText("processLabel", status?.connectedProcessLabel ?? "\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445");
  setText("lastError", status?.lastError ?? "\u041d\u0435\u0442");
});
