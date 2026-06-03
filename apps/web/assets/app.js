const APP_BASE_PATH = "/app";
const LOGIN_PATH = `${APP_BASE_PATH}/login`;
const FEED_PATH = `${APP_BASE_PATH}/parties`;
const CALLBACK_SUCCESS_PATH = `${APP_BASE_PATH}/auth/callback/success`;
const CALLBACK_ERROR_PATH = `${APP_BASE_PATH}/auth/callback/error`;
const PARTY_DETAIL_PREFIX = `${FEED_PATH}/`;

const appElement = document.querySelector("#app");
let shellNotice = null;

function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

function readCookie(name) {
  const prefix = `${name}=`;

  for (const segment of document.cookie.split(";")) {
    const trimmed = segment.trim();

    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }

  return null;
}

function safeReturnTo(candidate) {
  if (!candidate || typeof candidate !== "string") {
    return FEED_PATH;
  }

  if (!candidate.startsWith(APP_BASE_PATH) || candidate.startsWith("//")) {
    return FEED_PATH;
  }

  return candidate;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setNotice(kind, message) {
  shellNotice = { kind, message };
}

function renderNotice() {
  if (!shellNotice) {
    return "";
  }

  return `
    <article class="notice notice-${escapeHtml(shellNotice.kind)}">
      ${escapeHtml(shellNotice.message)}
    </article>
  `;
}

function setShellHtml(html) {
  appElement.innerHTML = `<div class="panel-body">${html}</div>`;
}

function formatHostName(host) {
  if (host.globalDisplayName) {
    if (
      host.globalDisplayNameCode !== null &&
      host.globalDisplayNameCode !== undefined &&
      !host.globalDisplayName.includes("#")
    ) {
      return `${host.globalDisplayName}#${String(host.globalDisplayNameCode).padStart(4, "0")}`;
    }

    return host.globalDisplayName;
  }

  return host.bungieDisplayName ?? "Unknown host";
}

function formatViewerName(me) {
  return me?.profile?.primaryDisplayName ?? "Unknown guardian";
}

function formatPartyPerson(person) {
  if (person.globalDisplayName) {
    if (
      person.globalDisplayNameCode !== null &&
      person.globalDisplayNameCode !== undefined &&
      !person.globalDisplayName.includes("#")
    ) {
      return `${person.globalDisplayName}#${String(person.globalDisplayNameCode).padStart(4, "0")}`;
    }

    return person.globalDisplayName;
  }

  return person.bungieDisplayName ?? "Unknown guardian";
}

function describeVerification(party) {
  return party.requiresMarathonVerified
    ? "Marathon verified required"
    : "Open to unverified players";
}

function formatCapacity(party) {
  return `${party.filledSlots}/${party.maxSize} slots`;
}

function getCsrfToken() {
  const csrfToken = readCookie("mlfg_csrf");
  if (!csrfToken) {
    throw new Error("The browser session is missing its CSRF cookie. Refresh or sign in again.");
  }

  return csrfToken;
}

function buildMutationHeaders(json = false) {
  const headers = {
    "X-CSRF-Token": getCsrfToken()
  };

  if (json) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function buildFeedItem(party) {
  const tags = (party.tags ?? [])
    .map((tag) => `<span class="badge">${escapeHtml(tag.tagKey)}${tag.tagValue ? `:${escapeHtml(tag.tagValue)}` : ""}</span>`)
    .join("");

  return `
    <article class="feed-item">
      <div class="feed-heading">
        <div>
          <h3 class="feed-title">${escapeHtml(party.title)}</h3>
          <p class="feed-subtitle">${escapeHtml(party.activityKey)} · Host ${escapeHtml(formatHostName(party.host))}</p>
        </div>
        <span class="badge ${party.status === "open" ? "badge-positive" : "badge-muted"}">${escapeHtml(party.status)}</span>
      </div>
      <div class="feed-meta">
        <span class="badge">${escapeHtml(formatCapacity(party))}</span>
        <span class="badge">${escapeHtml(describeVerification(party))}</span>
        ${party.myMembership ? `<span class="badge badge-warning">${escapeHtml(`Your status: ${party.myMembership.status}`)}</span>` : ""}
        ${tags}
      </div>
      <div class="feed-actions">
        <a class="button button-secondary" href="${PARTY_DETAIL_PREFIX}${encodeURIComponent(party.partyId)}">Open party</a>
      </div>
    </article>
  `;
}

function buildHostMemberItem(partyId, member) {
  const isPending = member.status === "pending";
  const actionButtons = isPending
    ? `
        <button class="button" data-action="moderate-member" data-party-id="${escapeHtml(partyId)}" data-member-id="${escapeHtml(member.memberId)}" data-moderation="accept">Accept</button>
        <button class="button button-secondary" data-action="moderate-member" data-party-id="${escapeHtml(partyId)}" data-member-id="${escapeHtml(member.memberId)}" data-moderation="decline">Decline</button>
        <button class="button button-danger" data-action="moderate-member" data-party-id="${escapeHtml(partyId)}" data-member-id="${escapeHtml(member.memberId)}" data-moderation="kick">Kick</button>
      `
    : `
        <button class="button button-danger" data-action="moderate-member" data-party-id="${escapeHtml(partyId)}" data-member-id="${escapeHtml(member.memberId)}" data-moderation="kick">Kick</button>
      `;

  return `
    <article class="member-item">
      <div class="member-copy">
        <div class="member-header">
          <h3 class="member-name">${escapeHtml(formatPartyPerson(member))}</h3>
          <span class="badge ${member.status === "pending" ? "badge-warning" : "badge-positive"}">${escapeHtml(member.status)}</span>
        </div>
        <p class="meta">User ${escapeHtml(member.userId)}</p>
        ${member.noteToHost ? `<p class="meta">Note: ${escapeHtml(member.noteToHost)}</p>` : ""}
      </div>
      <div class="member-actions">
        ${actionButtons}
      </div>
    </article>
  `;
}

function renderCreatePartyCard(me) {
  if (!me) {
    return "";
  }

  if (!me.capabilities.canUsePwaPartyWrites) {
    return `
      <article class="card">
        <p class="route-tag">Browser write gate</p>
        <h2 class="card-title">Party creation is locked</h2>
        <p class="meta">This account needs Marathon verification before the shell can create or join parties.</p>
      </article>
    `;
  }

  return `
    <article class="card">
      <p class="route-tag">POST /parties</p>
      <h2 class="card-title">Create a browser-side party</h2>
      <p class="meta">This uses the same cookie-authenticated API route as the native client, with CSRF protection.</p>
      <form class="form-grid" data-form="create-party">
        <label class="field">
          <span>Title</span>
          <input name="title" type="text" maxlength="120" placeholder="Shield run in 10" required />
        </label>
        <label class="field">
          <span>Max size</span>
          <input name="maxSize" type="number" min="2" max="6" value="3" required />
        </label>
        <label class="field field-full">
          <span>Description</span>
          <textarea name="description" rows="3" placeholder="Short callout for the run."></textarea>
        </label>
        <label class="field field-full">
          <span>Requirement text</span>
          <input name="requirementText" type="text" maxlength="160" placeholder="Bring shields and mic." />
        </label>
        <div class="button-row">
          <button class="button" type="submit">Create party</button>
        </div>
      </form>
    </article>
  `;
}

function renderFeedView(parties, me) {
  const intro = me
    ? `
        <article class="card">
          <p class="route-tag">${escapeHtml(window.location.pathname)}</p>
          <h2 class="card-title">${escapeHtml(formatViewerName(me))}</h2>
          <p class="meta">The browser shell can now bootstrap, resync Bungie identity, create parties, join from detail, leave, and cancel with cookie-authenticated CSRF-protected API calls.</p>
          <div class="badge-row">
            ${me.marathon.verified ? '<span class="badge badge-positive">Marathon verified</span>' : '<span class="badge badge-warning">Marathon verification missing</span>'}
            ${me.capabilities.canUsePwaPartyWrites ? '<span class="badge badge-positive">browser party writes enabled</span>' : '<span class="badge badge-warning">browser party writes locked</span>'}
            ${me.capabilities.canUsePwaBungieResync ? '<span class="badge badge-positive">Bungie resync enabled</span>' : '<span class="badge badge-muted">Bungie resync unavailable</span>'}
          </div>
          <div class="button-row">
            <button class="button button-secondary" data-action="refresh-bootstrap">Refresh shell</button>
            ${me.capabilities.canUsePwaBungieResync ? '<button class="button button-secondary" data-action="resync">Resync Bungie</button>' : ""}
            <button class="button button-danger" data-action="logout">Log out</button>
          </div>
        </article>
      `
    : `
        <article class="card">
          <p class="route-tag">${escapeHtml(window.location.pathname)}</p>
          <h2 class="card-title">Browse parties first</h2>
          <p class="meta">Public party reads are available without signing in. Sign in with Bungie when you want browser-side create, join, and account bootstrap.</p>
          <div class="button-row">
            <button class="button" data-action="login">Continue with Bungie</button>
          </div>
        </article>
      `;

  const feedItems = parties.items.length
    ? parties.items.map(buildFeedItem).join("")
    : `
        <article class="feed-item">
          <h3 class="feed-title">No public parties yet</h3>
          <p class="feed-subtitle">Create one from this shell or the native flow once you are signed in and verified.</p>
        </article>
      `;

  setShellHtml(`
    <div class="stack">
      ${renderNotice()}
      ${intro}
      ${renderCreatePartyCard(me)}
      <article class="card">
        <p class="route-tag">GET /parties</p>
        <h2 class="card-title">Party feed</h2>
        <p class="meta">The feed stays public, while party writes now use the same browser session and CSRF boundary as the rest of the PWA flow.</p>
        <div class="feed-list" style="margin-top: 1rem;">
          ${feedItems}
        </div>
      </article>
    </div>
  `);
}

function buildActionCard(party, me) {
  if (!me) {
    return `
      <article class="card">
        <p class="route-tag">Viewer actions</p>
        <h2 class="card-title">Sign in to interact</h2>
        <p class="meta">Public reads work without auth. Party mutations require the browser session.</p>
        <div class="button-row">
          <button class="button" data-action="login">Continue with Bungie</button>
        </div>
      </article>
    `;
  }

  const isHost = party.host.userId === me.userId;
  const membershipStatus = party.myMembership?.status ?? null;

  if (isHost) {
    const roster = party.members.length
      ? party.members.map((member) => buildHostMemberItem(party.partyId, member)).join("")
      : `<article class="member-item"><p class="meta">No pending or accepted members yet.</p></article>`;

    return `
      <article class="card">
        <p class="route-tag">Host actions</p>
        <h2 class="card-title">You host this party</h2>
        <p class="meta">Host moderation is live in the browser shell for pending and accepted members.</p>
        <div class="member-list">
          ${roster}
        </div>
        <div class="button-row">
          <button class="button button-secondary" data-action="refresh-bootstrap">Refresh shell</button>
          ${me.capabilities.canUsePwaBungieResync ? '<button class="button button-secondary" data-action="resync">Resync Bungie</button>' : ""}
          ${party.status !== "cancelled" ? `<button class="button button-danger" data-action="cancel-party" data-party-id="${escapeHtml(party.partyId)}">Cancel party</button>` : ""}
        </div>
      </article>
    `;
  }

  if (membershipStatus === "pending" || membershipStatus === "accepted") {
    return `
      <article class="card">
        <p class="route-tag">Membership action</p>
        <h2 class="card-title">You are ${escapeHtml(membershipStatus)}</h2>
        <p class="meta">Leave the party here if your plans change.</p>
        <div class="button-row">
          <button class="button button-secondary" data-action="refresh-bootstrap">Refresh shell</button>
          <button class="button button-danger" data-action="leave-party" data-party-id="${escapeHtml(party.partyId)}">Leave party</button>
        </div>
      </article>
    `;
  }

  if (!me.capabilities.canUsePwaPartyWrites) {
    return `
      <article class="card">
        <p class="route-tag">Viewer actions</p>
        <h2 class="card-title">Party writes are locked</h2>
        <p class="meta">This account does not currently meet the backend requirements for browser-side party mutations.</p>
      </article>
    `;
  }

  if (party.status !== "open") {
    return `
      <article class="card">
        <p class="route-tag">Viewer actions</p>
        <h2 class="card-title">Party is not joinable</h2>
        <p class="meta">This party is currently ${escapeHtml(party.status)}.</p>
      </article>
    `;
  }

  if (party.requiresMarathonVerified && !me.marathon.verified) {
    return `
      <article class="card">
        <p class="route-tag">Viewer actions</p>
        <h2 class="card-title">Verification required</h2>
        <p class="meta">This party requires Marathon verification before you can join it from the browser shell.</p>
      </article>
    `;
  }

  return `
    <article class="card">
      <p class="route-tag">POST /parties/:partyId/join</p>
      <h2 class="card-title">Join this party</h2>
      <p class="meta">Joining from the shell uses the same API route as the native flow, with a CSRF-protected cookie session.</p>
      <form class="form-grid" data-form="join-party" data-party-id="${escapeHtml(party.partyId)}">
        <label class="field field-full">
          <span>Note to host</span>
          <textarea name="noteToHost" rows="3" placeholder="Optional note for the host."></textarea>
        </label>
        <div class="button-row">
          <button class="button" type="submit">Join party</button>
          ${me.capabilities.canUsePwaBungieResync ? '<button class="button button-secondary" type="button" data-action="resync">Resync Bungie</button>' : ""}
        </div>
      </form>
    </article>
  `;
}

function renderPartyDetail(party, me) {
  const tagBadges = (party.tags ?? [])
    .map((tag) => `<span class="badge">${escapeHtml(tag.tagKey)}${tag.tagValue ? `:${escapeHtml(tag.tagValue)}` : ""}</span>`)
    .join("");

  const membershipBlock = party.myMembership
    ? `
        <div class="detail-row">
          <span class="detail-label">Your membership</span>
          <p class="meta">${escapeHtml(party.myMembership.status)}${party.myMembership.noteToHost ? ` · ${escapeHtml(party.myMembership.noteToHost)}` : ""}</p>
        </div>
      `
    : `
        <div class="detail-row">
          <span class="detail-label">Your membership</span>
          <p class="meta">You do not have an active membership for this party.</p>
        </div>
      `;

  setShellHtml(`
    <div class="stack">
      ${renderNotice()}
      <article class="card">
        <p class="route-tag">GET /parties/:partyId</p>
        <h2 class="card-title">${escapeHtml(party.title)}</h2>
        <p class="meta">${escapeHtml(party.activityKey)} · Hosted by ${escapeHtml(formatHostName(party.host))}</p>
        <div class="badge-row">
          <span class="badge ${party.status === "open" ? "badge-positive" : "badge-muted"}">${escapeHtml(party.status)}</span>
          <span class="badge">${escapeHtml(formatCapacity(party))}</span>
          <span class="badge">${escapeHtml(describeVerification(party))}</span>
          ${tagBadges}
        </div>
        <div class="button-row">
          <a class="button button-secondary" href="${FEED_PATH}">Back to feed</a>
          ${me ? '<button class="button button-secondary" data-action="refresh-bootstrap">Refresh shell</button>' : '<button class="button" data-action="login">Continue with Bungie</button>'}
        </div>
      </article>

      <div class="detail-grid">
        <article class="card">
          <p class="route-tag">Summary</p>
          <div class="detail-list">
            <div class="detail-row">
              <span class="detail-label">Visibility</span>
              <p class="meta">${escapeHtml(party.visibility)}</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Approval mode</span>
              <p class="meta">${escapeHtml(party.approvalMode)}</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Voice required</span>
              <p class="meta">${party.voiceRequired ? "Yes" : "No"}</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Requirement text</span>
              <p class="meta">${party.requirementText ? escapeHtml(party.requirementText) : "None provided"}</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Description</span>
              <p class="meta">${party.description ? escapeHtml(party.description) : "No description yet"}</p>
            </div>
          </div>
        </article>

        <article class="card">
          <p class="route-tag">Viewer state</p>
          <div class="detail-list">
            ${membershipBlock}
            <div class="detail-row">
              <span class="detail-label">Viewer</span>
              <p class="meta">${escapeHtml(me ? formatViewerName(me) : "Signed-out browser visitor")}</p>
            </div>
            <div class="detail-row">
              <span class="detail-label">Last updated</span>
              <p class="meta">${escapeHtml(party.updatedAt)}</p>
            </div>
          </div>
        </article>
      </div>

      ${buildActionCard(party, me)}
    </div>
  `);
}

function renderSignedOut(reason = "Sign in with Bungie to bootstrap the browser shell.") {
  setShellHtml(`
    <div class="card-grid">
      ${renderNotice()}
      <article class="card">
        <p class="route-tag">${escapeHtml(window.location.pathname)}</p>
        <h2 class="card-title">Sign in to the web shell</h2>
        <p class="meta">${escapeHtml(reason)}</p>
        <div class="button-row">
          <button class="button" data-action="login">Continue with Bungie</button>
          <a class="button button-secondary" href="${FEED_PATH}">Browse parties</a>
        </div>
      </article>
    </div>
  `);
}

function renderCallbackPending() {
  setShellHtml(`
    <div class="card-grid">
      <article class="card">
        <p class="route-tag">${escapeHtml(window.location.pathname)}</p>
        <h2 class="card-title">Finishing sign-in</h2>
        <p class="meta loading-dots">Finalizing your first-party session</p>
      </article>
    </div>
  `);
}

function renderCallbackError() {
  const code = getQueryParam("code") ?? "callback_failed";

  setShellHtml(`
    <div class="card-grid">
      <article class="card">
        <p class="route-tag">${escapeHtml(window.location.pathname)}</p>
        <h2 class="card-title">Sign-in failed</h2>
        <p class="meta">Backend callback returned <strong>${escapeHtml(code)}</strong>. Retry the login flow once the upstream issue is resolved.</p>
        <div class="button-row">
          <button class="button" data-action="login">Try again</button>
          <a class="button button-secondary" href="${FEED_PATH}">Open party feed</a>
        </div>
      </article>
    </div>
  `);
}

async function apiJson(path, init = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {})
    },
    ...init
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.message ?? `Request failed: ${response.status}`);
    error.code = payload?.error ?? "request_failed";
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function beginLogin() {
  const returnTo = safeReturnTo(window.location.pathname);
  const payload = await apiJson("/auth/bungie/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      redirectMode: "web",
      returnTo
    })
  });

  window.location.assign(payload.authorizeUrl);
}

async function fetchBootstrapState() {
  const session = await apiJson("/auth/session");

  if (!session.authenticated) {
    return {
      session,
      me: null
    };
  }

  return {
    session,
    me: await apiJson("/me")
  };
}

function getPartyIdFromPath() {
  if (!window.location.pathname.startsWith(PARTY_DETAIL_PREFIX)) {
    return null;
  }

  const raw = window.location.pathname.slice(PARTY_DETAIL_PREFIX.length);
  return raw ? decodeURIComponent(raw) : null;
}

function readTrimmedField(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function handleCreateParty(form) {
  const formData = new FormData(form);
  const title = readTrimmedField(formData, "title");
  const maxSizeValue = readTrimmedField(formData, "maxSize");
  const description = readTrimmedField(formData, "description");
  const requirementText = readTrimmedField(formData, "requirementText");
  const maxSize = Number.parseInt(maxSizeValue, 10);

  if (!title) {
    throw new Error("Party title is required.");
  }

  if (!Number.isInteger(maxSize) || maxSize < 2) {
    throw new Error("Max size must be at least 2.");
  }

  const payload = await apiJson("/parties", {
    method: "POST",
    headers: buildMutationHeaders(true),
    body: JSON.stringify({
      title,
      activityKey: "marathon",
      maxSize,
      ...(description ? { description } : {}),
      ...(requirementText ? { requirementText } : {})
    })
  });

  setNotice("success", `Created "${title}" and opened its detail view.`);
  window.history.pushState({}, "", `${PARTY_DETAIL_PREFIX}${encodeURIComponent(payload.partyId)}`);
  await renderCurrentView();
}

async function handleJoinParty(form) {
  const partyId = form.dataset.partyId;
  if (!partyId) {
    throw new Error("Join form is missing its target party.");
  }

  const formData = new FormData(form);
  const noteToHost = readTrimmedField(formData, "noteToHost");
  const payload = noteToHost ? { noteToHost } : {};

  const response = await apiJson(`/parties/${encodeURIComponent(partyId)}/join`, {
    method: "POST",
    headers: buildMutationHeaders(true),
    body: JSON.stringify(payload)
  });

  setNotice("success", `Join request submitted. Current status: ${response.myStatus}.`);
  await renderCurrentView();
}

async function handleLeaveParty(partyId) {
  await apiJson(`/parties/${encodeURIComponent(partyId)}/leave`, {
    method: "POST",
    headers: buildMutationHeaders()
  });

  setNotice("success", "You left the party.");
  await renderCurrentView();
}

async function handleCancelParty(partyId) {
  await apiJson(`/parties/${encodeURIComponent(partyId)}/cancel`, {
    method: "POST",
    headers: buildMutationHeaders()
  });

  setNotice("success", "Party cancelled.");
  await renderCurrentView();
}

async function handleResync() {
  const me = await apiJson("/me/bungie/resync", {
    method: "POST",
    headers: buildMutationHeaders()
  });

  setNotice("success", `Bungie profile refreshed for ${formatViewerName(me)}.`);
  await renderCurrentView();
}

async function handleMemberModeration(partyId, memberId, moderation) {
  const allowedActions = new Set(["accept", "decline", "kick"]);
  if (!allowedActions.has(moderation)) {
    throw new Error("Unsupported moderation action.");
  }

  const result = await apiJson(
    `/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(memberId)}/${moderation}`,
    {
      method: "POST",
      headers: buildMutationHeaders()
    }
  );

  setNotice("success", `Member moved to ${result.memberStatus}.`);
  await renderCurrentView();
}

async function renderCurrentView() {
  const { me } = await fetchBootstrapState();

  if (window.location.pathname === CALLBACK_SUCCESS_PATH) {
    renderCallbackPending();
    const returnTo = safeReturnTo(getQueryParam("returnTo"));
    setNotice("success", "Sign-in completed. Browser session is active.");
    window.history.replaceState({}, "", returnTo);
    return renderCurrentView();
  }

  if (window.location.pathname === CALLBACK_ERROR_PATH) {
    renderCallbackError();
    return;
  }

  if (window.location.pathname === LOGIN_PATH) {
    if (me) {
      window.history.replaceState({}, "", FEED_PATH);
      return renderCurrentView();
    }

    renderSignedOut();
    return;
  }

  if (window.location.pathname === APP_BASE_PATH || window.location.pathname === `${APP_BASE_PATH}/` || window.location.pathname === FEED_PATH) {
    const parties = await apiJson("/parties");
    renderFeedView(parties, me);
    return;
  }

  const partyId = getPartyIdFromPath();
  if (partyId) {
    const party = await apiJson(`/parties/${encodeURIComponent(partyId)}`);
    renderPartyDetail(party, me);
    return;
  }

  const parties = await apiJson("/parties");
  renderFeedView(parties, me);
}

async function handleLogout() {
  const csrfToken = readCookie("mlfg_csrf");

  if (!csrfToken) {
    window.history.replaceState({}, "", LOGIN_PATH);
    renderSignedOut("The web session is already gone. Sign in again to continue.");
    return;
  }

  await apiJson("/auth/logout", {
    method: "POST",
    headers: {
      "X-CSRF-Token": csrfToken
    }
  });

  setNotice("success", "Browser session cleared.");
  window.history.replaceState({}, "", FEED_PATH);
  await renderCurrentView();
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionTarget = target.closest("[data-action]");
  if (!(actionTarget instanceof HTMLElement)) {
    return;
  }

  const action = actionTarget.dataset.action;
  if (!action) {
    return;
  }

  try {
    if (action === "login") {
      await beginLogin();
      return;
    }

    if (action === "refresh-bootstrap") {
      await renderCurrentView();
      return;
    }

    if (action === "logout") {
      await handleLogout();
      return;
    }

    if (action === "resync") {
      await handleResync();
      return;
    }

    if (action === "leave-party") {
      const partyId = actionTarget.dataset.partyId;
      if (!partyId) {
        throw new Error("The leave action is missing its party id.");
      }

      await handleLeaveParty(partyId);
      return;
    }

    if (action === "cancel-party") {
      const partyId = actionTarget.dataset.partyId;
      if (!partyId) {
        throw new Error("The cancel action is missing its party id.");
      }

      await handleCancelParty(partyId);
      return;
    }

    if (action === "moderate-member") {
      const partyId = actionTarget.dataset.partyId;
      const memberId = actionTarget.dataset.memberId;
      const moderation = actionTarget.dataset.moderation;
      if (!partyId || !memberId || !moderation) {
        throw new Error("The moderation action is missing required metadata.");
      }

      await handleMemberModeration(partyId, memberId, moderation);
    }
  } catch (error) {
    setNotice("error", error.message);
    await renderCurrentView();
  }
});

document.addEventListener("submit", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  const formName = target.dataset.form;
  if (!formName) {
    return;
  }

  event.preventDefault();

  try {
    if (formName === "create-party") {
      await handleCreateParty(target);
      return;
    }

    if (formName === "join-party") {
      await handleJoinParty(target);
    }
  } catch (error) {
    setNotice("error", error.message);
    await renderCurrentView();
  }
});

window.addEventListener("popstate", () => {
  void renderCurrentView();
});

void renderCurrentView().catch((error) => {
  setNotice("error", error.message);
  renderSignedOut(error.message);
});
