(() => {
  'use strict';

  const state = {
    user: null,
    model: null,
    selectedFile: null,
    objectUrl: null,
    currentAnalysis: null,
    history: [],
    historyPage: 1,
    historyPageSize: 8,
    toastTimer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const elements = {
    publicView: $('#publicView'),
    siteHeader: $('#siteHeader'),
    workspace: $('#workspace'),
    siteFooter: $('#siteFooter'),
    authDialog: $('#authDialog'),
    authMessage: $('#authMessage'),
    authTitle: $('#authTitle'),
    authSubtitle: $('#authSubtitle'),
    loginForm: $('#loginForm'),
    signupForm: $('#signupForm'),
    guestHeaderActions: $('#guestHeaderActions'),
    signedInHeaderActions: $('#signedInHeaderActions'),
    headerAvatar: $('#headerAvatar'),
    workspaceUserName: $('#workspaceUserName'),
    workspaceAvatar: $('#workspaceAvatar'),
    modelBanner: $('#modelBanner'),
    modelBannerTitle: $('#modelBannerTitle'),
    modelBannerText: $('#modelBannerText'),
    modelBannerTag: $('#modelBannerTag'),
    sidebarModelCard: $('#sidebarModelCard'),
    sidebarModelStatus: $('#sidebarModelStatus'),
    sidebarModelText: $('#sidebarModelText'),
    fileInput: $('#fileInput'),
    dropzone: $('#dropzone'),
    dropzoneEmpty: $('#dropzoneEmpty'),
    dropzonePreview: $('#dropzonePreview'),
    selectedImagePreview: $('#selectedImagePreview'),
    selectedFileRow: $('#selectedFileRow'),
    selectedFileName: $('#selectedFileName'),
    selectedFileSize: $('#selectedFileSize'),
    analyzeButton: $('#analyzeButton'),
    uploadError: $('#uploadError'),
    toast: $('#toast'),
  };

  async function api(path, options = {}) {
    const init = { credentials: 'same-origin', ...options };
    init.headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* empty response */ }
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showToast(message) {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => elements.toast.classList.remove('show'), 3200);
  }

  function setAuthMessage(message = '') {
    elements.authMessage.textContent = message;
    elements.authMessage.hidden = !message;
  }

  function setAuthTab(mode) {
    const isSignup = mode === 'signup';
    $('#loginTab').classList.toggle('active', !isSignup);
    $('#signupTab').classList.toggle('active', isSignup);
    $('#loginTab').setAttribute('aria-selected', String(!isSignup));
    $('#signupTab').setAttribute('aria-selected', String(isSignup));
    elements.loginForm.hidden = isSignup;
    elements.signupForm.hidden = !isSignup;
    elements.authTitle.textContent = isSignup ? 'Create your account' : 'Welcome back';
    elements.authSubtitle.textContent = isSignup
      ? 'Set up a private workspace for your project.'
      : 'Sign in to continue to your workspace.';
    setAuthMessage('');
  }

  function openAuth(mode = 'login') {
    setAuthTab(mode);
    elements.authDialog.hidden = false;
    elements.authDialog.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const target = mode === 'signup' ? $('#signupName') : $('#loginEmail');
      target?.focus();
    }, 80);
  }

  function closeAuth() {
    elements.authDialog.hidden = true;
    elements.authDialog.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function initials(name) {
    const parts = String(name || 'User').trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (parts[0] || 'U').slice(0, 1).toUpperCase();
  }

  function renderUser(user) {
    state.user = user || null;
    const isSignedIn = Boolean(state.user);
    elements.guestHeaderActions.hidden = isSignedIn;
    elements.signedInHeaderActions.hidden = !isSignedIn;
    if (isSignedIn) {
      const mark = initials(state.user.name);
      elements.headerAvatar.querySelector('span').textContent = mark;
      elements.workspaceAvatar.textContent = mark;
      elements.workspaceUserName.textContent = state.user.name;
      $('#dashboardGreeting').textContent = `Welcome, ${state.user.name}. Here is your recent project activity.`;
    }
  }

  function openWorkspace() {
    if (!state.user) {
      openAuth('signup');
      return;
    }
    elements.publicView.hidden = true;
    elements.siteHeader.hidden = true;
    elements.siteFooter.hidden = true;
    elements.workspace.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    switchScreen('dashboard');
    refreshHistoryCount();
  }

  function closeWorkspace() {
    elements.workspace.hidden = true;
    elements.siteHeader.hidden = false;
    elements.publicView.hidden = false;
    elements.siteFooter.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function switchScreen(screenName) {
    const names = ['dashboard', 'upload', 'analysis', 'results', 'history'];
    if (!names.includes(screenName)) screenName = 'dashboard';
    $$('[data-screen-panel]').forEach((panel) => {
      const active = panel.dataset.screenPanel === screenName;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    const navScreen = ['analysis', 'results'].includes(screenName) ? 'upload' : screenName;
    $$('[data-screen]').forEach((button) => button.classList.toggle('active', button.dataset.screen === navScreen));
    if (screenName === 'dashboard') loadDashboard();
    if (screenName === 'history') loadHistory();
  }

  function showModelStatus(model) {
    state.model = model || { ready: false, message: 'Model readiness could not be checked.' };
    const ready = Boolean(state.model.ready);
    elements.modelBanner.classList.toggle('is-ready', ready);
    elements.modelBannerTitle.textContent = ready ? 'Trained model is connected' : 'Model weights are not connected';
    elements.modelBannerText.textContent = ready
      ? 'AI inference is enabled. Any output still requires professional review.'
      : (state.model.message || 'Upload and preprocessing work, but no prediction will be generated without trained weights.');
    elements.modelBannerTag.textContent = ready ? 'READY' : 'SETUP';
    elements.sidebarModelCard.classList.toggle('is-ready', ready);
    elements.sidebarModelCard.classList.toggle('is-warning', !ready);
    elements.sidebarModelStatus.textContent = ready ? 'Model connected' : 'Model not connected';
    elements.sidebarModelText.textContent = ready
      ? `${state.model.backend || 'AI'} · ${state.model.model_name || 'configured weights'}`
      : 'Upload workflow is ready; connect trained weights for inference.';
    const dashboardStatus = $('#dashboardModelStatus');
    if (dashboardStatus) {
      dashboardStatus.classList.toggle('is-ready', ready);
      dashboardStatus.querySelector('b').textContent = ready ? 'Model connected' : 'Model not connected';
      $('#dashboardModelText').textContent = ready
        ? `${state.model.backend || 'AI'} model ${state.model.model_name || 'is ready'}; results still need human review.`
        : 'Upload and preprocessing work. Configure trained weights to enable actual predictions.';
    }
  }

  async function checkHealth() {
    try {
      const response = await api('/api/health');
      showModelStatus(response.model);
    } catch (_) {
      showModelStatus({ ready: false, message: 'Could not read the model configuration.' });
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showUploadError(message = '') {
    elements.uploadError.textContent = message;
    elements.uploadError.hidden = !message;
  }

  function clearSelectedFile() {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    state.selectedFile = null;
    elements.fileInput.value = '';
    elements.dropzoneEmpty.hidden = false;
    elements.dropzonePreview.hidden = true;
    elements.selectedFileRow.hidden = true;
    elements.analyzeButton.disabled = true;
    showUploadError('');
  }

  function selectFile(file) {
    if (!file) return;
    showUploadError('');
    const extensionOk = /\.(png|jpe?g)$/i.test(file.name || '');
    const mimeOk = ['image/png', 'image/jpeg', ''].includes(file.type);
    if (!extensionOk || !mimeOk) {
      clearSelectedFile();
      showUploadError('Choose a PNG or JPG/JPEG image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      clearSelectedFile();
      showUploadError('This image is larger than 10 MB. Choose a smaller file.');
      return;
    }
    if (!file.size) {
      clearSelectedFile();
      showUploadError('This file is empty. Choose another image.');
      return;
    }
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.selectedFile = file;
    state.objectUrl = URL.createObjectURL(file);
    elements.selectedImagePreview.src = state.objectUrl;
    elements.selectedImagePreview.alt = `Preview of ${file.name}`;
    elements.dropzoneEmpty.hidden = true;
    elements.dropzonePreview.hidden = false;
    elements.selectedFileRow.hidden = false;
    elements.selectedFileName.textContent = file.name;
    elements.selectedFileSize.textContent = formatBytes(file.size);
    elements.analyzeButton.disabled = false;
  }

  function setProgress(value) {
    const percentage = Math.max(0, Math.min(100, value));
    $('#progressBar').style.width = `${percentage}%`;
    $('#progressPercent').textContent = `${percentage}%`;
  }

  function resetProgress() {
    $$('.progress-step').forEach((step, index) => {
      step.classList.remove('done', 'active');
      const icon = $('.progress-step-icon', step);
      icon.textContent = String(index + 1).padStart(2, '0');
      if (index === 0) step.classList.add('active');
    });
    setProgress(0);
  }

  async function advanceProgressUntil(promise) {
    const steps = $$('.progress-step');
    // Attach both handlers immediately so a fast validation error is never an unhandled rejection.
    const settled = promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    for (let i = 0; i < 3; i += 1) {
      await delay(i === 2 ? 360 : 280);
      steps[i].classList.remove('active');
      steps[i].classList.add('done');
      $('.progress-step-icon', steps[i]).textContent = '✓';
      steps[i + 1].classList.add('active');
      setProgress([24, 48, 72][i]);
    }
    const result = await settled;
    if (!result.ok) throw result.error;
    steps[2].classList.remove('active');
    steps[2].classList.add('done');
    $('.progress-step-icon', steps[2]).textContent = '✓';
    steps[3].classList.remove('active');
    steps[3].classList.add('done');
    $('.progress-step-icon', steps[3]).textContent = '✓';
    setProgress(100);
    return result.value;
  }

  function dateText(value, includeYear = true) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit',
    });
  }

  function cleanFilename(name) {
    const cleaned = String(name || 'boneai-analysis').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
    return cleaned.slice(0, 70) || 'boneai-analysis';
  }

  async function startAnalysis() {
    if (!state.selectedFile) return;
    showUploadError('');
    const file = state.selectedFile;
    const localUrl = state.objectUrl;
    elements.analyzeButton.disabled = true;
    $('#analysisFilename').textContent = file.name;
    $('#analysisImagePreview').src = localUrl;
    $('#analysisImagePreview').alt = `Preparing ${file.name}`;
    $('#analysisImageDimensions').textContent = 'Validating image dimensions…';
    resetProgress();
    switchScreen('analysis');

    const form = new FormData();
    form.append('image', file, file.name);
    const requestPromise = api('/api/analyze', { method: 'POST', body: form });
    const progressPromise = advanceProgressUntil(requestPromise);
    let payload;
    try {
      payload = await progressPromise;
    } catch (error) {
      if (error.status === 401) {
        switchScreen('upload');
        elements.analyzeButton.disabled = false;
        openAuth('login');
        setAuthMessage('Please sign in to continue.');
        return;
      }
      switchScreen('upload');
      elements.analyzeButton.disabled = false;
      showUploadError(error.message || 'The image could not be analyzed. Please try again.');
      return;
    }

    state.currentAnalysis = payload.analysis;
    if (payload.model) showModelStatus(payload.model);
    const analysis = state.currentAnalysis;
    $('#analysisImageDimensions').textContent = `${analysis.image_width} × ${analysis.image_height} px · grayscale input prepared`;
    await delay(280);
    renderResult(analysis);
    switchScreen('results');
    refreshHistoryCount();
  }

  function setResultState(kind, title, subtitle) {
    const box = $('#resultState');
    box.classList.remove('is-positive', 'is-negative', 'is-warning');
    if (kind === 'positive') box.classList.add('is-positive');
    if (kind === 'negative') box.classList.add('is-negative');
    if (kind === 'warning') box.classList.add('is-warning');
    $('#resultStateTitle').textContent = title;
    $('#resultStateSubtitle').textContent = subtitle;
    $('#resultStateIcon').textContent = kind === 'positive' ? '!' : kind === 'negative' ? '✓' : 'i';
  }

  function positionLocalization(box) {
    const image = $('#resultImage');
    const frame = $('#resultImageFrame');
    const overlay = $('#localizationBox');
    if (!image.complete || !image.naturalWidth || !box || box.length < 4) return;
    const [x1, y1, x2, y2] = box.map((value) => Math.max(0, Math.min(1, Number(value))));
    if (!(x2 > x1 && y2 > y1)) return;
    const frameRect = frame.getBoundingClientRect();
    const scale = Math.min(frameRect.width / image.naturalWidth, frameRect.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const offsetX = (frameRect.width - renderedWidth) / 2;
    const offsetY = (frameRect.height - renderedHeight) / 2;
    overlay.style.left = `${offsetX + x1 * renderedWidth}px`;
    overlay.style.top = `${offsetY + y1 * renderedHeight}px`;
    overlay.style.width = `${(x2 - x1) * renderedWidth}px`;
    overlay.style.height = `${(y2 - y1) * renderedHeight}px`;
  }

  function renderResult(analysis) {
    state.currentAnalysis = analysis;
    $('#resultFilename').textContent = analysis.original_name || 'X-ray image';
    $('#resultImage').src = `${analysis.image_url}?v=${encodeURIComponent(analysis.id)}`;
    $('#resultImage').alt = `Uploaded X-ray: ${analysis.original_name || 'image'}`;
    $('#resultDimensions').textContent = `${analysis.image_width} × ${analysis.image_height} px`;
    $('#resultDate').textContent = dateText(analysis.created_at);
    $('#resultMetric').hidden = true;
    $('#resultFacts').hidden = true;
    $('#setupInstructions').hidden = true;
    $('#localizationBox').hidden = true;
    $('#noLocalizationLabel').hidden = true;
    $('#resultMessage').textContent = analysis.message || '';
    $('#reviewLabel').value = analysis.review_label || 'none';
    $('#reviewNote').value = analysis.review_note || '';
    const hasModelResult = analysis.status === 'completed';
    Array.from($('#reviewLabel').options).forEach((option) => {
      if (['agree', 'disagree'].includes(option.value)) option.disabled = !hasModelResult;
    });
    $('#reviewSavedAt').textContent = analysis.review_updated_at
      ? `Saved ${dateText(analysis.review_updated_at)}`
      : 'Notes are private to this account.';

    if (analysis.status === 'model_unavailable') {
      setResultState('warning', 'Model not connected', 'Image validated and saved; no prediction was generated.');
      $('#setupInstructions').hidden = false;
      return;
    }
    if (analysis.status === 'error') {
      setResultState('warning', 'Model inference failed', 'No screening result is available for this image.');
      return;
    }
    if (analysis.label === 'fracture_suspected') {
      setResultState('positive', 'Suspected fracture', 'The model flagged a potential fracture. Professional review is required.');
      $('#classificationValue').textContent = 'Fracture suspected';
    } else {
      setResultState('negative', 'No fracture detected', 'The model did not flag a fracture. This is not an all-clear.');
      $('#classificationValue').textContent = 'No fracture detected';
    }

    if (Number.isFinite(Number(analysis.confidence))) {
      const score = Math.round(Number(analysis.confidence) * 100);
      $('#confidenceValue').textContent = `${score}%`;
      $('#confidenceTrack').style.width = `${Math.max(0, Math.min(100, score))}%`;
      $('#resultMetric').hidden = false;
    }
    $('#localizationValue').textContent = analysis.box ? 'Model region available' : 'Not provided by model';
    $('#resultFacts').hidden = false;
    if (analysis.box) {
      const showBox = () => {
        $('#localizationBox').hidden = false;
        $('#noLocalizationLabel').hidden = true;
        positionLocalization(analysis.box);
      };
      const image = $('#resultImage');
      if (image.complete) showBox();
      else image.addEventListener('load', showBox, { once: true });
    } else {
      $('#noLocalizationLabel').hidden = false;
    }
  }

  function printReport() {
    const analysis = state.currentAnalysis;
    if (!analysis) return;
    const reportWindow = window.open(`/api/analyses/${encodeURIComponent(analysis.id)}/report`, '_blank');
    if (!reportWindow) showToast('Allow pop-ups to open the printable report.');
  }

  async function saveReview() {
    const analysis = state.currentAnalysis;
    if (!analysis) return;
    const button = $('#saveReviewButton');
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Saving…';
    try {
      const response = await api(`/api/analyses/${encodeURIComponent(analysis.id)}/review`, {
        method: 'POST',
        body: { review_label: $('#reviewLabel').value, review_note: $('#reviewNote').value },
      });
      state.currentAnalysis = response.analysis;
      $('#reviewSavedAt').textContent = `Saved ${dateText(response.analysis.review_updated_at)}`;
      showToast('Reviewer notes saved separately from the model output.');
      if (!$('#dashboardScreen').hidden) loadDashboard();
      if (!$('#historyScreen').hidden) loadHistory();
    } catch (error) {
      showToast(error.message || 'Could not save reviewer notes.');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function downloadReport() {
    const analysis = state.currentAnalysis;
    if (!analysis) return;
    const statusLabels = {
      model_unavailable: 'Model unavailable — image upload/preprocessing only',
      error: 'Inference error — no model result available',
      completed: analysis.label === 'fracture_suspected' ? 'Suspected fracture' : 'No fracture detected',
    };
    const hasConfidence = analysis.confidence !== null && analysis.confidence !== undefined && Number.isFinite(Number(analysis.confidence));
    const lines = [
      'BONEAI — X-RAY SCREENING REVIEW',
      '================================',
      `Generated: ${new Date().toLocaleString()}`,
      `Image: ${analysis.original_name || 'X-ray image'}`,
      `Image dimensions: ${analysis.image_width} x ${analysis.image_height} px`,
      `Analysis created: ${dateText(analysis.created_at)}`,
      `Workflow status: ${statusLabels[analysis.status] || analysis.status}`,
      `Classification: ${analysis.label || 'Not available'}`,
      `Model confidence: ${hasConfidence ? `${Math.round(Number(analysis.confidence) * 100)}%` : 'Not available'}`,
      `Model: ${analysis.model_version || 'Not configured'}`,
      `Localization box: ${analysis.box ? JSON.stringify(analysis.box) : 'Not provided'}`,
      `Human reviewer status: ${analysis.review_label || 'Not reviewed'}`,
      `Human reviewer notes: ${analysis.review_note || 'None'}`,
      '',
      `Note: ${analysis.message || ''}`,
      '',
      'SAFETY NOTICE',
      'This is an educational research prototype, not a medical device or diagnosis.',
      'Do not use this report for treatment decisions. A qualified medical professional',
      'must review the original image and any model output.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${cleanFilename(analysis.original_name).replace(/\.(png|jpe?g)$/i, '')}-boneai-report.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function statusDetails(analysis) {
    if (analysis.status === 'model_unavailable') return { label: 'Model needed', className: '' };
    if (analysis.status === 'error') return { label: 'Inference error', className: 'status-error' };
    if (analysis.label === 'fracture_suspected') return { label: 'Review flagged', className: 'status-fracture' };
    return { label: 'Model complete', className: 'status-completed' };
  }

  function outputText(analysis) {
    if (analysis.status !== 'completed') return { text: 'No result generated', className: '' };
    if (analysis.label === 'fracture_suspected') return { text: 'Suspected fracture', className: 'is-suspected' };
    return { text: 'No fracture detected', className: 'is-normal' };
  }

  async function loadDashboard() {
    if (!state.user) return;
    try {
      const response = await api('/api/dashboard');
      const stats = response.stats || {};
      $('#dashboardTotal').textContent = String(stats.total || 0);
      $('#dashboardCompleted').textContent = String(stats.completed || 0);
      $('#dashboardWaiting').textContent = String(stats.waiting || 0);
      $('#dashboardReviewed').textContent = String(stats.reviewed || 0);
      $('#historyCount').textContent = String(stats.total || 0);
      renderDashboardRecent(response.recent || []);
    } catch (error) {
      if (error.status === 401) {
        openAuth('login');
        setAuthMessage('Your session ended. Please sign in again.');
      } else {
        showToast(error.message || 'Could not load dashboard summary.');
      }
    }
  }

  function renderDashboardRecent(analyses) {
    const list = $('#dashboardRecentList');
    const empty = $('#dashboardRecentEmpty');
    list.replaceChildren();
    empty.hidden = analyses.length > 0;
    analyses.forEach((analysis) => {
      const item = document.createElement('div');
      item.className = 'dashboard-recent-item';
      const image = document.createElement('img');
      image.src = `${analysis.image_url}?recent=1`;
      image.alt = 'X-ray thumbnail';
      image.loading = 'lazy';
      const details = document.createElement('div');
      details.className = 'dashboard-recent-details';
      const name = document.createElement('b');
      name.textContent = analysis.original_name || 'X-ray image';
      name.title = analysis.original_name || 'X-ray image';
      const date = document.createElement('small');
      date.textContent = dateText(analysis.created_at);
      details.append(name, date);
      const badgeInfo = statusDetails(analysis);
      const badge = document.createElement('span');
      badge.className = `status-badge ${badgeInfo.className}`.trim();
      badge.textContent = badgeInfo.label;
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'table-action';
      view.textContent = 'Open';
      view.addEventListener('click', () => viewAnalysis(analysis.id));
      item.append(image, details, badge, view);
      list.appendChild(item);
    });
  }

  function historyMatches(analysis, search, filter) {
    if (search && !String(analysis.original_name || '').toLowerCase().includes(search)) return false;
    if (filter === 'all') return true;
    if (filter === 'reviewed') return Boolean(analysis.review_label || analysis.review_note);
    if (filter === 'completed') return analysis.status === 'completed';
    if (filter === 'model_unavailable' || filter === 'error') return analysis.status === filter;
    return analysis.label === filter;
  }

  function renderHistory() {
    const body = $('#historyTableBody');
    const empty = $('#historyEmpty');
    const search = $('#historySearch').value.trim().toLowerCase();
    const filter = $('#historyStatusFilter').value;
    const matches = state.history.filter((analysis) => historyMatches(analysis, search, filter));
    const pageCount = Math.max(1, Math.ceil(matches.length / state.historyPageSize));
    state.historyPage = Math.min(Math.max(1, state.historyPage), pageCount);
    const startIndex = (state.historyPage - 1) * state.historyPageSize;
    const visible = matches.slice(startIndex, startIndex + state.historyPageSize);

    $('#historyTotal').textContent = `${state.history.length} ${state.history.length === 1 ? 'record' : 'records'}`;
    $('#historyShowingCount').textContent = matches.length
      ? `Showing ${startIndex + 1}–${Math.min(startIndex + visible.length, matches.length)} of ${matches.length}`
      : 'Showing 0 records';
    $('#historyPageLabel').textContent = `Page ${state.historyPage} of ${pageCount}`;
    $('#historyPrev').disabled = state.historyPage <= 1;
    $('#historyNext').disabled = state.historyPage >= pageCount;
    $('#historyPagination').hidden = matches.length <= state.historyPageSize;
    empty.hidden = visible.length > 0;
    $('.history-table').hidden = visible.length === 0;

    if (!state.history.length) {
      $('#historyEmptyTitle').textContent = 'No analyses yet';
      $('#historyEmptyText').textContent = 'Upload an X-ray to create your first review record.';
      $('#historyEmptyButton').textContent = 'Upload an image';
    } else if (!matches.length) {
      $('#historyEmptyTitle').textContent = 'No matching records';
      $('#historyEmptyText').textContent = 'Try a different file-name search or status filter.';
      $('#historyEmptyButton').textContent = 'Clear search and filters';
    }
    body.replaceChildren();
    visible.forEach((analysis) => {
      const row = document.createElement('tr');
      const imageCell = document.createElement('td');
      const image = document.createElement('img');
      image.className = 'history-thumb';
      image.alt = 'X-ray thumbnail';
      image.loading = 'lazy';
      image.src = `${analysis.image_url}?thumb=1`;
      imageCell.appendChild(image);

      const fileCell = document.createElement('td');
      const filename = document.createElement('span');
      filename.className = 'history-file-name';
      filename.textContent = analysis.original_name || 'X-ray image';
      filename.title = analysis.original_name || 'X-ray image';
      const date = document.createElement('span');
      date.className = 'history-date';
      date.textContent = dateText(analysis.created_at);
      fileCell.append(filename, date);

      const statusCell = document.createElement('td');
      const badgeInfo = statusDetails(analysis);
      const badge = document.createElement('span');
      badge.className = `status-badge ${badgeInfo.className}`.trim();
      badge.textContent = badgeInfo.label;
      statusCell.appendChild(badge);

      const outputCell = document.createElement('td');
      const output = outputText(analysis);
      const outputLabel = document.createElement('span');
      outputLabel.className = `output-label ${output.className}`.trim();
      outputLabel.textContent = output.text;
      if (analysis.status === 'completed' && analysis.confidence !== null && Number.isFinite(Number(analysis.confidence))) {
        const confidence = document.createElement('span');
        confidence.className = 'history-date';
        confidence.textContent = `${Math.round(Number(analysis.confidence) * 100)}% model score`;
        outputCell.append(outputLabel, confidence);
      } else {
        outputCell.appendChild(outputLabel);
      }
      if (analysis.review_label || analysis.review_note) {
        const review = document.createElement('span');
        review.className = 'history-date review-mini';
        review.textContent = `Human: ${analysis.review_label ? analysis.review_label.replaceAll('_', ' ') : 'note saved'}`;
        outputCell.appendChild(review);
      }

      const actionCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const viewButton = document.createElement('button');
      viewButton.type = 'button';
      viewButton.className = 'table-action';
      viewButton.textContent = 'Review';
      viewButton.addEventListener('click', () => viewAnalysis(analysis.id));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'table-action danger';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteAnalysis(analysis.id));
      actions.append(viewButton, deleteButton);
      actionCell.appendChild(actions);

      row.append(imageCell, fileCell, statusCell, outputCell, actionCell);
      body.appendChild(row);
    });
  }

  async function loadHistory() {
    if (!state.user) return;
    try {
      const response = await api('/api/history');
      state.history = response.analyses || [];
      state.historyPage = 1;
      $('#historyCount').textContent = String(state.history.length);
      renderHistory();
    } catch (error) {
      if (error.status === 401) {
        openAuth('login');
        setAuthMessage('Your session ended. Please sign in again.');
      } else {
        showToast(error.message || 'Could not load analysis history.');
      }
    }
  }

  async function refreshHistoryCount() {
    if (!state.user) return;
    try {
      const response = await api('/api/history');
      $('#historyCount').textContent = String((response.analyses || []).length);
    } catch (_) { /* history count is decorative; full history has its own error handling */ }
  }

  async function viewAnalysis(id) {
    try {
      const response = await api(`/api/analyses/${encodeURIComponent(id)}`);
      state.currentAnalysis = response.analysis;
      renderResult(response.analysis);
      switchScreen('results');
    } catch (error) {
      showToast(error.message || 'Could not open that analysis.');
    }
  }

  async function deleteAnalysis(id) {
    if (!window.confirm('Delete this image and its analysis record from your history?')) return;
    try {
      await api(`/api/analyses/${encodeURIComponent(id)}`, { method: 'DELETE' });
      showToast('The analysis record was deleted.');
      await loadHistory();
      if (state.currentAnalysis?.id === id) state.currentAnalysis = null;
    } catch (error) {
      showToast(error.message || 'Could not delete that record.');
    }
  }

  async function submitAuth(event, mode) {
    event.preventDefault();
    setAuthMessage('');
    const form = event.currentTarget;
    const submitButton = $('.auth-submit', form);
    const oldText = submitButton.innerHTML;
    submitButton.disabled = true;
    submitButton.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    const data = Object.fromEntries(new FormData(form).entries());
    if (mode === 'login') data.remember = $('#rememberMe').checked;
    try {
      const response = await api(mode === 'signup' ? '/api/register' : '/api/login', { method: 'POST', body: data });
      renderUser(response.user);
      closeAuth();
      openWorkspace();
      showToast(mode === 'signup' ? 'Your BoneAI workspace is ready.' : 'Signed in successfully.');
    } catch (error) {
      setAuthMessage(error.message || 'Could not complete sign-in.');
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = oldText;
    }
  }

  async function signOut() {
    try { await api('/api/logout', { method: 'POST' }); } catch (_) { /* clear local view even if session has expired */ }
    renderUser(null);
    state.currentAnalysis = null;
    state.history = [];
    clearSelectedFile();
    closeWorkspace();
    showToast('You have been signed out.');
  }

  function initEventListeners() {
    $$('.open-auth').forEach((button) => button.addEventListener('click', () => openAuth(button.dataset.mode || 'login')));
    $$('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
    $('#authCloseButton').addEventListener('click', closeAuth);
    elements.authDialog.addEventListener('click', (event) => {
      if (event.target === elements.authDialog) closeAuth();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !elements.authDialog.hidden) closeAuth();
    });
    elements.loginForm.addEventListener('submit', (event) => submitAuth(event, 'login'));
    elements.signupForm.addEventListener('submit', (event) => submitAuth(event, 'signup'));
    $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
    }));

    $('#heroStartButton').addEventListener('click', openWorkspace);
    $('#closingStartButton').addEventListener('click', openWorkspace);
    $$('[data-open-workspace]').forEach((button) => button.addEventListener('click', openWorkspace));
    $('#headerAvatar').addEventListener('click', openWorkspace);
    $('#backToSite').addEventListener('click', closeWorkspace);
    $('#logoutButton').addEventListener('click', signOut);
    $('#dashboardNewAnalysis').addEventListener('click', () => { clearSelectedFile(); switchScreen('upload'); });
    $('#dashboardUploadButton').addEventListener('click', () => { clearSelectedFile(); switchScreen('upload'); });
    $('#dashboardEmptyUpload').addEventListener('click', () => { clearSelectedFile(); switchScreen('upload'); });
    $('#dashboardHistoryButton').addEventListener('click', () => switchScreen('history'));

    $('#mobileMenuToggle').addEventListener('click', () => {
      const open = $('#mainNav').classList.toggle('is-open');
      $('#mobileMenuToggle').setAttribute('aria-expanded', String(open));
    });
    $$('.main-nav .nav-link').forEach((link) => link.addEventListener('click', () => {
      $('#mainNav').classList.remove('is-open');
      $('#mobileMenuToggle').setAttribute('aria-expanded', 'false');
      $$('.main-nav .nav-link').forEach((navLink) => navLink.classList.toggle('active', navLink === link));
    }));

    elements.dropzone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      elements.fileInput.click();
    });
    elements.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        elements.fileInput.click();
      }
    });
    $('#browseButton').addEventListener('click', (event) => {
      event.stopPropagation();
      elements.fileInput.click();
    });
    $('#removeImageButton').addEventListener('click', (event) => {
      event.stopPropagation();
      clearSelectedFile();
    });
    elements.fileInput.addEventListener('change', () => selectFile(elements.fileInput.files?.[0]));
    ['dragenter', 'dragover'].forEach((eventName) => elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.dropzone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((eventName) => elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.dropzone.classList.remove('is-dragging');
    }));
    elements.dropzone.addEventListener('drop', (event) => selectFile(event.dataTransfer?.files?.[0]));
    elements.analyzeButton.addEventListener('click', startAnalysis);

    $$('[data-screen]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.screen === 'upload' && !$('#uploadScreen').classList.contains('active')) clearSelectedFile();
      switchScreen(button.dataset.screen);
    }));
    $('#newAnalysisButton').addEventListener('click', () => {
      clearSelectedFile();
      switchScreen('upload');
    });
    $('#historyNewButton').addEventListener('click', () => {
      clearSelectedFile();
      switchScreen('upload');
    });
    $('#historyEmptyButton').addEventListener('click', () => {
      if (state.history.length) {
        $('#historySearch').value = '';
        $('#historyStatusFilter').value = 'all';
        state.historyPage = 1;
        renderHistory();
      } else {
        clearSelectedFile();
        switchScreen('upload');
      }
    });
    $('#historySearch').addEventListener('input', () => { state.historyPage = 1; renderHistory(); });
    $('#historyStatusFilter').addEventListener('change', () => { state.historyPage = 1; renderHistory(); });
    $('#historyPrev').addEventListener('click', () => { state.historyPage -= 1; renderHistory(); });
    $('#historyNext').addEventListener('click', () => { state.historyPage += 1; renderHistory(); });
    $('#viewHistoryButton').addEventListener('click', () => switchScreen('history'));
    $('#printReportButton').addEventListener('click', printReport);
    $('#downloadReportButton').addEventListener('click', downloadReport);
    $('#saveReviewButton').addEventListener('click', saveReview);
    $('#resultImage').addEventListener('load', () => {
      if (state.currentAnalysis?.box) positionLocalization(state.currentAnalysis.box);
    });
    window.addEventListener('resize', () => {
      if (state.currentAnalysis?.box) positionLocalization(state.currentAnalysis.box);
    });
  }

  async function init() {
    initEventListeners();
    await checkHealth();
    try {
      const response = await api('/api/me');
      if (response.authenticated) renderUser(response.user);
    } catch (_) { /* public landing remains usable */ }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
