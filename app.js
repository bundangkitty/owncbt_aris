(() => {
  "use strict";

  const BACKUP_FORMAT = "game-development-club-offline";
  const BACKUP_VERSION = 1;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const MAX_QUESTIONS = 50_000;
  const DB_NAME = "game-club-offline-v1";
  const DB_VERSION = 1;

  const $ = (id) => document.getElementById(id);
  const elements = {
    emptyView: $("emptyView"),
    dashboardView: $("dashboardView"),
    unitProgressView: $("unitProgressView"),
    browseView: $("browseView"),
    studyView: $("studyView"),
    backupFile: $("backupFile"),
    datasetMeta: $("datasetMeta"),
    networkBadge: $("networkBadge"),
    toast: $("toast"),
    statTotal: $("statTotal"),
    statCorrect: $("statCorrect"),
    statIncorrect: $("statIncorrect"),
    statUnknown: $("statUnknown"),
    subjectFilter: $("subjectFilter"),
    lectureFilter: $("lectureFilter"),
    deckFilter: $("deckFilter"),
    tagFilter: $("tagFilter"),
    countFilter: $("countFilter"),
    shuffleFilter: $("shuffleFilter"),
    matchedCount: $("matchedCount"),
    startAll: $("startAll"),
    startIncorrect: $("startIncorrect"),
    startUnknown: $("startUnknown"),
    openUnitProgress: $("openUnitProgress"),
    leaveUnitProgress: $("leaveUnitProgress"),
    deleteAllProgress: $("deleteAllProgress"),
    unitProgressAttempted: $("unitProgressAttempted"),
    unitProgressTotal: $("unitProgressTotal"),
    unitProgressRemaining: $("unitProgressRemaining"),
    unitProgressList: $("unitProgressList"),
    unitBrowserList: $("unitBrowserList"),
    leaveBrowse: $("leaveBrowse"),
    browseCount: $("browseCount"),
    browseTitle: $("browseTitle"),
    browseDescription: $("browseDescription"),
    browseQuestionList: $("browseQuestionList"),
    startBrowseRandom: $("startBrowseRandom"),
    deleteData: $("deleteData"),
    leaveStudy: $("leaveStudy"),
    studyMode: $("studyMode"),
    studyProgress: $("studyProgress"),
    progressBar: $("progressBar"),
    questionClassificationDetails: $("questionClassificationDetails"),
    questionMeta: $("questionMeta"),
    questionStem: $("questionStem"),
    questionImages: $("questionImages"),
    questionOptions: $("questionOptions"),
    answerActions: $("answerActions"),
    markUnknown: $("markUnknown"),
    checkAnswer: $("checkAnswer"),
    resultPanel: $("resultPanel"),
    resultIcon: $("resultIcon"),
    resultText: $("resultText"),
    correctAnswerText: $("correctAnswerText"),
    explanationText: $("explanationText"),
    nextQuestion: $("nextQuestion"),
  };

  let databasePromise;
  let dataset = null;
  let progress = new Map();
  let sessionQuestions = [];
  let sessionIndex = 0;
  let selectedAnswer = null;
  let revealedStatus = null;
  let browsedDeckId = null;
  let browsedQuestions = [];
  let studyReturnView = "dashboard";
  let toastTimer;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("content")) db.createObjectStore("content");
        if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "questionId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("로컬 저장소를 열지 못했습니다."));
    });
    return databasePromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("로컬 저장소 작업에 실패했습니다."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("로컬 저장소 작업에 실패했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("로컬 저장소 작업이 취소되었습니다."));
    });
  }

  async function getDataset() {
    const db = await openDatabase();
    return requestResult(db.transaction("content", "readonly").objectStore("content").get("dataset"));
  }

  async function saveDataset(value) {
    const db = await openDatabase();
    const transaction = db.transaction("content", "readwrite");
    transaction.objectStore("content").put(value, "dataset");
    await transactionDone(transaction);
  }

  async function getAllProgress() {
    const db = await openDatabase();
    return requestResult(db.transaction("progress", "readonly").objectStore("progress").getAll());
  }

  async function saveProgress(record) {
    const db = await openDatabase();
    const transaction = db.transaction("progress", "readwrite");
    transaction.objectStore("progress").put(record);
    await transactionDone(transaction);
  }

  async function deleteProgressRecords(questionIds) {
    if (questionIds.size === 0) return;
    const db = await openDatabase();
    const transaction = db.transaction("progress", "readwrite");
    const store = transaction.objectStore("progress");
    questionIds.forEach((questionId) => store.delete(questionId));
    await transactionDone(transaction);
  }

  async function clearProgressRecords() {
    const db = await openDatabase();
    const transaction = db.transaction("progress", "readwrite");
    transaction.objectStore("progress").clear();
    await transactionDone(transaction);
  }

  async function removeOrphanedProgress(validQuestionIds) {
    const records = await getAllProgress();
    const orphanIds = records.filter((record) => !validQuestionIds.has(record.questionId)).map((record) => record.questionId);
    if (orphanIds.length === 0) return;

    const db = await openDatabase();
    const transaction = db.transaction("progress", "readwrite");
    const store = transaction.objectStore("progress");
    orphanIds.forEach((id) => store.delete(id));
    await transactionDone(transaction);
  }

  async function clearLocalData() {
    const db = await openDatabase();
    const transaction = db.transaction(["content", "progress"], "readwrite");
    transaction.objectStore("content").clear();
    transaction.objectStore("progress").clear();
    await transactionDone(transaction);
  }

  function requireString(value, field, allowEmpty = false) {
    if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
      throw new Error(`${field} 값이 올바르지 않습니다.`);
    }
    return value;
  }

  function validateBackup(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("올바른 문제 파일이 아닙니다.");
    if (value.format !== BACKUP_FORMAT) throw new Error("이 앱에서 만든 문제 파일이 아닙니다.");
    if (value.version !== BACKUP_VERSION) throw new Error(`지원하지 않는 파일 버전입니다. 필요한 버전: ${BACKUP_VERSION}`);
    if (!Array.isArray(value.questions) || !Array.isArray(value.decks)) throw new Error("문제 또는 분류 데이터가 없습니다.");
    if (value.questions.length > MAX_QUESTIONS) throw new Error(`문제는 최대 ${MAX_QUESTIONS.toLocaleString()}개까지 가져올 수 있습니다.`);

    const deckIds = new Set();
    const decks = value.decks.map((deck, index) => {
      if (!deck || typeof deck !== "object") throw new Error(`${index + 1}번째 분류가 올바르지 않습니다.`);
      const id = requireString(deck.id, `${index + 1}번째 분류 ID`);
      if (deckIds.has(id)) throw new Error(`분류 ID가 중복되었습니다: ${id}`);
      deckIds.add(id);
      if (deck.parentId !== null && typeof deck.parentId !== "string") throw new Error(`${index + 1}번째 상위 분류가 올바르지 않습니다.`);
      if (!Number.isFinite(deck.sortOrder)) throw new Error(`${index + 1}번째 분류 순서가 올바르지 않습니다.`);
      return { id, name: requireString(deck.name, `${index + 1}번째 분류 이름`), parentId: deck.parentId, sortOrder: deck.sortOrder };
    });

    const questionIds = new Set();
    const questions = value.questions.map((question, index) => {
      const row = index + 1;
      if (!question || typeof question !== "object") throw new Error(`${row}번째 문제가 올바르지 않습니다.`);
      const id = requireString(question.id, `${row}번째 문제 ID`);
      if (questionIds.has(id)) throw new Error(`문제 ID가 중복되었습니다: ${id}`);
      questionIds.add(id);
      if (!Array.isArray(question.options) || question.options.length !== 5) throw new Error(`${row}번째 문제의 선지는 정확히 5개여야 합니다.`);
      const options = question.options.map((option, optionIndex) => requireString(option, `${row}번째 문제 ${optionIndex + 1}번 선지`));
      if (!Number.isInteger(question.correctAnswer) || question.correctAnswer < 1 || question.correctAnswer > 5) throw new Error(`${row}번째 문제의 정답은 1~5여야 합니다.`);
      if (!Number.isFinite(question.examYear)) throw new Error(`${row}번째 문제의 연도가 올바르지 않습니다.`);
      if (!Array.isArray(question.tags) || question.tags.some((tag) => typeof tag !== "string")) throw new Error(`${row}번째 문제의 태그가 올바르지 않습니다.`);
      if (question.deckId !== null && typeof question.deckId !== "string") throw new Error(`${row}번째 문제의 분류가 올바르지 않습니다.`);
      const rawImages = question.images === undefined ? [] : question.images;
      if (!Array.isArray(rawImages) || rawImages.length > 5) throw new Error(`${row}번째 문제의 사진 정보가 올바르지 않습니다.`);
      const images = rawImages.map((image, imageIndex) => {
        if (!image || typeof image !== "object") throw new Error(`${row}번째 문제 ${imageIndex + 1}번 사진이 올바르지 않습니다.`);
        const dataUrl = requireString(image.dataUrl, `${row}번째 문제 ${imageIndex + 1}번 사진 데이터`);
        if (!/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(dataUrl)) throw new Error(`${row}번째 문제 ${imageIndex + 1}번 사진 형식이 올바르지 않습니다.`);
        return {
          id: requireString(image.id, `${row}번째 문제 ${imageIndex + 1}번 사진 ID`),
          altText: typeof image.altText === "string" ? image.altText : "",
          width: Number.isFinite(image.width) && image.width > 0 ? image.width : 1,
          height: Number.isFinite(image.height) && image.height > 0 ? image.height : 1,
          dataUrl,
        };
      });

      return {
        id,
        subject: requireString(question.subject, `${row}번째 문제 과목`),
        lecture: requireString(question.lecture, `${row}번째 문제 강의`),
        professor: requireString(question.professor, `${row}번째 문제 교수`),
        examYear: question.examYear,
        stem: requireString(question.stem, `${row}번째 문제 본문`),
        options,
        correctAnswer: question.correctAnswer,
        explanation: requireString(question.explanation, `${row}번째 문제 해설`, true),
        deckId: question.deckId,
        tags: [...new Set(question.tags.map((tag) => tag.trim()).filter(Boolean))],
        images,
        updatedAt: typeof question.updatedAt === "string" ? question.updatedAt : "",
      };
    });

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: requireString(value.exportedAt, "내보낸 시각"),
      decks,
      questions,
    };
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, isError ? 5000 : 2800);
  }

  function showView(name) {
    elements.emptyView.hidden = name !== "empty";
    elements.dashboardView.hidden = name !== "dashboard";
    elements.unitProgressView.hidden = name !== "progress";
    elements.browseView.hidden = name !== "browse";
    elements.studyView.hidden = name !== "study";
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function sortedUnique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function fillSelect(select, values, emptyLabel) {
    const previous = select.value;
    select.replaceChildren();
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = emptyLabel;
    select.append(emptyOption);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
    select.value = values.includes(previous) ? previous : "";
  }

  function flattenDecks(decks) {
    const byParent = new Map();
    decks.forEach((deck) => {
      const parent = deck.parentId && decks.some((item) => item.id === deck.parentId) ? deck.parentId : null;
      const siblings = byParent.get(parent) || [];
      siblings.push(deck);
      byParent.set(parent, siblings);
    });
    byParent.forEach((items) => items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ko")));

    const flat = [];
    const visited = new Set();
    function walk(parentId, depth, parentPath) {
      (byParent.get(parentId) || []).forEach((deck) => {
        if (visited.has(deck.id)) return;
        visited.add(deck.id);
        const path = parentPath ? `${parentPath} > ${deck.name}` : deck.name;
        flat.push({ ...deck, depth, path });
        walk(deck.id, depth + 1, path);
      });
    }
    walk(null, 0, "");
    decks.filter((deck) => !visited.has(deck.id)).forEach((deck) => flat.push({ ...deck, depth: 0, path: deck.name }));
    return flat;
  }

  function deckPathMap() {
    return new Map(flattenDecks(dataset ? dataset.decks : []).map((deck) => [deck.id, deck.path]));
  }

  function populateLectureFilter() {
    const selectedSubject = elements.subjectFilter.value;
    const lectures = sortedUnique(dataset.questions
      .filter((question) => !selectedSubject || question.subject === selectedSubject)
      .map((question) => question.lecture));
    fillSelect(elements.lectureFilter, lectures, "전체 강의");
  }

  function populateFilters() {
    fillSelect(elements.subjectFilter, sortedUnique(dataset.questions.map((question) => question.subject)), "전체 과목");
    populateLectureFilter();
    fillSelect(elements.tagFilter, sortedUnique(dataset.questions.flatMap((question) => question.tags)), "전체 태그");

    const flat = flattenDecks(dataset.decks);
    elements.deckFilter.replaceChildren();
    const allDecks = document.createElement("option");
    allDecks.value = "";
    allDecks.textContent = "전체 단원";
    elements.deckFilter.append(allDecks);
    flat.forEach((deck) => {
      const option = document.createElement("option");
      option.value = deck.id;
      option.textContent = `${"— ".repeat(deck.depth)}${deck.name}`;
      elements.deckFilter.append(option);
    });
  }

  function descendantDeckIds(deckId) {
    if (!deckId) return null;
    const ids = new Set([deckId]);
    let changed = true;
    while (changed) {
      changed = false;
      dataset.decks.forEach((deck) => {
        if (deck.parentId && ids.has(deck.parentId) && !ids.has(deck.id)) {
          ids.add(deck.id);
          changed = true;
        }
      });
    }
    return ids;
  }

  function questionsForDeck(deckId) {
    if (!dataset) return [];
    if (deckId === "__unclassified__") return dataset.questions.filter((question) => !question.deckId);
    const deckIds = descendantDeckIds(deckId);
    return dataset.questions.filter((question) => question.deckId && deckIds.has(question.deckId));
  }

  function sortQuestionsForList(questions) {
    return [...questions].sort((a, b) => {
      if (a.examYear !== b.examYear) return b.examYear - a.examYear;
      const subject = a.subject.localeCompare(b.subject, "ko");
      if (subject !== 0) return subject;
      return a.stem.localeCompare(b.stem, "ko");
    });
  }

  function populateUnitBrowser() {
    elements.unitBrowserList.replaceChildren();
    const flat = flattenDecks(dataset.decks);
    const unclassifiedCount = dataset.questions.filter((question) => !question.deckId).length;

    if (flat.length === 0 && unclassifiedCount === 0) {
      const empty = document.createElement("p");
      empty.className = "unit-browser-empty";
      empty.textContent = "등록된 단원이 없습니다.";
      elements.unitBrowserList.append(empty);
      return;
    }

    function appendUnit(deckId, name, depth, count) {
      const button = document.createElement("button");
      button.className = "unit-browser-item";
      button.type = "button";
      button.style.setProperty("--deck-depth", String(depth));
      const title = document.createElement("span");
      const branch = document.createElement("i");
      branch.textContent = depth > 0 ? "↳" : "•";
      const label = document.createElement("b");
      label.textContent = name;
      title.append(branch, label);
      const total = document.createElement("small");
      total.textContent = `${count.toLocaleString()}문제`;
      const arrow = document.createElement("em");
      arrow.textContent = "→";
      button.append(title, total, arrow);
      button.addEventListener("click", () => renderUnitQuestions(deckId));
      elements.unitBrowserList.append(button);
    }

    flat.forEach((deck) => appendUnit(deck.id, deck.name, deck.depth, questionsForDeck(deck.id).length));
    if (unclassifiedCount > 0) appendUnit("__unclassified__", "미분류", 0, unclassifiedCount);
  }

  function attemptedQuestions(questions) {
    return questions.filter((question) => progress.has(question.id));
  }

  function renderUnitProgressRow(deckId, name, depth) {
    const questions = sortQuestionsForList(questionsForDeck(deckId));
    const attempted = attemptedQuestions(questions).length;
    const remaining = questions.length - attempted;
    const percentage = questions.length === 0 ? 0 : Math.round((attempted / questions.length) * 100);

    const item = document.createElement("article");
    item.className = "unit-progress-item";
    item.style.setProperty("--deck-depth", String(depth));

    const main = document.createElement("button");
    main.className = "unit-progress-main";
    main.type = "button";
    main.disabled = questions.length === 0;
    const title = document.createElement("span");
    const branch = document.createElement("i");
    branch.textContent = depth > 0 ? "↳" : "•";
    const label = document.createElement("b");
    label.textContent = name;
    title.append(branch, label);
    const meter = document.createElement("span");
    meter.className = "unit-progress-meter";
    const track = document.createElement("i");
    const fill = document.createElement("em");
    fill.style.width = `${percentage}%`;
    track.append(fill);
    const count = document.createElement("strong");
    count.textContent = `${attempted.toLocaleString()}/${questions.length.toLocaleString()}`;
    meter.append(track, count);
    main.append(title, meter);
    main.addEventListener("click", () => startUnitProgressQuestions(deckId, false));

    const actions = document.createElement("div");
    actions.className = "unit-progress-actions";
    const startAllButton = document.createElement("button");
    startAllButton.className = "unit-action-button";
    startAllButton.type = "button";
    startAllButton.textContent = "전체 풀기";
    startAllButton.disabled = questions.length === 0;
    startAllButton.addEventListener("click", () => startUnitProgressQuestions(deckId, false));
    const startRemainingButton = document.createElement("button");
    startRemainingButton.className = "unit-action-button remaining";
    startRemainingButton.type = "button";
    startRemainingButton.textContent = `안 푼 문제 ${remaining.toLocaleString()}개`;
    startRemainingButton.disabled = remaining === 0;
    startRemainingButton.addEventListener("click", () => startUnitProgressQuestions(deckId, true));
    const deleteButton = document.createElement("button");
    deleteButton.className = "unit-action-button delete";
    deleteButton.type = "button";
    deleteButton.textContent = "기록 삭제";
    deleteButton.disabled = attempted === 0;
    deleteButton.addEventListener("click", () => deleteUnitProgress(deckId, name));
    actions.append(startAllButton, startRemainingButton, deleteButton);

    item.append(main, actions);
    elements.unitProgressList.append(item);
  }

  function renderUnitProgress() {
    if (!dataset) {
      showView("empty");
      return;
    }

    const attempted = attemptedQuestions(dataset.questions).length;
    elements.unitProgressAttempted.textContent = attempted.toLocaleString();
    elements.unitProgressTotal.textContent = dataset.questions.length.toLocaleString();
    elements.unitProgressRemaining.textContent = (dataset.questions.length - attempted).toLocaleString();
    elements.deleteAllProgress.disabled = attempted === 0;
    elements.unitProgressList.replaceChildren();

    const flat = flattenDecks(dataset.decks);
    flat.forEach((deck) => renderUnitProgressRow(deck.id, deck.name, deck.depth));
    if (dataset.questions.some((question) => !question.deckId)) {
      renderUnitProgressRow("__unclassified__", "미분류", 0);
    }
    if (elements.unitProgressList.children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "unit-browser-empty";
      empty.textContent = "등록된 단원과 문항이 없습니다.";
      elements.unitProgressList.append(empty);
    }
    showView("progress");
  }

  function startUnitProgressQuestions(deckId, unattemptedOnly) {
    let questions = sortQuestionsForList(questionsForDeck(deckId));
    if (unattemptedOnly) questions = questions.filter((question) => !progress.has(question.id));
    if (questions.length === 0) {
      showToast(unattemptedOnly ? "이 단원에는 안 푼 문제가 없습니다." : "이 단원에 등록된 문제가 없습니다.", true);
      return;
    }
    sessionQuestions = questions;
    sessionIndex = 0;
    studyReturnView = "progress";
    elements.studyMode.textContent = unattemptedOnly ? "단원 · 안 푼 문제" : "단원 전체 풀기";
    showView("study");
    renderQuestion();
  }

  async function deleteUnitProgress(deckId, name) {
    const questionIds = new Set(questionsForDeck(deckId).filter((question) => progress.has(question.id)).map((question) => question.id));
    if (questionIds.size === 0) return;
    if (!window.confirm(`‘${name}’ 단원의 풀이기록 ${questionIds.size.toLocaleString()}개를 삭제할까요? 문제 데이터는 삭제되지 않습니다.`)) return;
    try {
      await deleteProgressRecords(questionIds);
      questionIds.forEach((questionId) => progress.delete(questionId));
      renderUnitProgress();
      showToast(`${name} 단원의 풀이기록을 삭제했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "풀이기록을 삭제하지 못했습니다.", true);
    }
  }

  async function deleteAllStudyProgress() {
    if (progress.size === 0) return;
    if (!window.confirm(`이 iPad에 저장된 전체 풀이기록 ${progress.size.toLocaleString()}개를 삭제할까요? 문제 데이터는 그대로 유지됩니다.`)) return;
    try {
      await clearProgressRecords();
      progress = new Map();
      renderUnitProgress();
      showToast("전체 풀이기록을 삭제했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "풀이기록을 삭제하지 못했습니다.", true);
    }
  }

  function renderUnitQuestions(deckId) {
    if (!dataset) return;
    browsedDeckId = deckId;
    browsedQuestions = sortQuestionsForList(questionsForDeck(deckId));
    const deck = dataset.decks.find((item) => item.id === deckId);
    const title = deckId === "__unclassified__" ? "미분류" : deck ? deckPathMap().get(deck.id) || deck.name : "단원별 문항";
    elements.browseTitle.textContent = title;
    elements.browseCount.textContent = `${browsedQuestions.length.toLocaleString()}문제`;
    elements.browseDescription.textContent = `${browsedQuestions.length.toLocaleString()}개 문항을 표시합니다. 문항을 누르면 바로 풀 수 있습니다.`;
    elements.startBrowseRandom.disabled = browsedQuestions.length === 0;
    elements.browseQuestionList.replaceChildren();

    if (browsedQuestions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "browse-question-empty";
      empty.textContent = "이 단원에 등록된 문항이 없습니다.";
      elements.browseQuestionList.append(empty);
    } else {
      browsedQuestions.forEach((question, index) => {
        const button = document.createElement("button");
        button.className = "browse-question-item";
        button.type = "button";
        const number = document.createElement("i");
        number.textContent = String(index + 1);
        const copy = document.createElement("span");
        const meta = document.createElement("small");
        meta.textContent = `${question.subject} · ${question.lecture} · ${question.professor} · ${question.examYear}`;
        const stem = document.createElement("strong");
        stem.textContent = question.stem;
        copy.append(meta, stem);
        const status = progress.get(question.id)?.status;
        const action = document.createElement("b");
        action.className = status ? `status-${status}` : "";
        action.textContent = status === "correct" ? "정답" : status === "incorrect" ? "오답" : status === "unknown" ? "모름" : "풀기 →";
        button.append(number, copy, action);
        button.addEventListener("click", () => startSingleQuestion(question));
        elements.browseQuestionList.append(button);
      });
    }
    showView("browse");
  }

  function filteredQuestions(statusMode = "all") {
    if (!dataset) return [];
    const subject = elements.subjectFilter.value;
    const lecture = elements.lectureFilter.value;
    const deckIds = descendantDeckIds(elements.deckFilter.value);
    const tag = elements.tagFilter.value;

    return dataset.questions.filter((question) => {
      if (subject && question.subject !== subject) return false;
      if (lecture && question.lecture !== lecture) return false;
      if (deckIds && (!question.deckId || !deckIds.has(question.deckId))) return false;
      if (tag && !question.tags.includes(tag)) return false;
      if (statusMode !== "all" && progress.get(question.id)?.status !== statusMode) return false;
      return true;
    });
  }

  function updateMatchedCount() {
    const count = filteredQuestions().length;
    elements.matchedCount.textContent = `${count.toLocaleString()}문제 선택됨`;
  }

  function updateStats() {
    const records = [...progress.values()];
    elements.statTotal.textContent = dataset ? dataset.questions.length.toLocaleString() : "0";
    elements.statCorrect.textContent = records.filter((item) => item.status === "correct").length.toLocaleString();
    elements.statIncorrect.textContent = records.filter((item) => item.status === "incorrect").length.toLocaleString();
    elements.statUnknown.textContent = records.filter((item) => item.status === "unknown").length.toLocaleString();
  }

  function formatExportedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function renderDashboard() {
    if (!dataset) {
      showView("empty");
      return;
    }
    const imageCount = dataset.questions.reduce((sum, question) => sum + question.images.length, 0);
    elements.datasetMeta.textContent = `${dataset.questions.length.toLocaleString()}문제 · 사진 ${imageCount.toLocaleString()}장 · ${formatExportedAt(dataset.exportedAt)} 내보냄`;
    updateStats();
    updateMatchedCount();
    populateUnitBrowser();
    showView("dashboard");
  }

  function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  }

  function requestedQuestionCount(availableCount) {
    const raw = elements.countFilter.value.trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      showToast("문제 수는 1 이상의 자연수로 입력해 주세요.", true);
      elements.countFilter.focus();
      return null;
    }
    return Math.min(Number(raw), availableCount);
  }

  function startStudy(statusMode) {
    let questions = filteredQuestions(statusMode);
    if (questions.length === 0) {
      const label = statusMode === "incorrect" ? "선택 범위에 오답" : statusMode === "unknown" ? "선택 범위에 모름 문제" : "선택 범위에 문제";
      showToast(`${label}가 없습니다.`, true);
      return;
    }
    const count = requestedQuestionCount(questions.length);
    if (count === null) return;
    if (elements.shuffleFilter.checked) questions = shuffle(questions);
    questions = questions.slice(0, count);

    sessionQuestions = questions;
    sessionIndex = 0;
    studyReturnView = "dashboard";
    elements.studyMode.textContent = statusMode === "incorrect" ? "오답 다시 풀기" : statusMode === "unknown" ? "모름 다시 풀기" : "선택 범위";
    showView("study");
    renderQuestion();
  }

  function startSingleQuestion(question) {
    sessionQuestions = [question];
    sessionIndex = 0;
    studyReturnView = "browse";
    elements.studyMode.textContent = "선택 문항";
    showView("study");
    renderQuestion();
  }

  function startBrowsedQuestions() {
    if (browsedQuestions.length === 0) return;
    const count = requestedQuestionCount(browsedQuestions.length);
    if (count === null) return;
    let questions = elements.shuffleFilter.checked ? shuffle(browsedQuestions) : [...browsedQuestions];
    questions = questions.slice(0, count);
    sessionQuestions = questions;
    sessionIndex = 0;
    studyReturnView = "browse";
    elements.studyMode.textContent = "선택 단원";
    showView("study");
    renderQuestion();
  }

  function renderStudyReturnView() {
    if (studyReturnView === "browse" && browsedDeckId) renderUnitQuestions(browsedDeckId);
    else if (studyReturnView === "progress") renderUnitProgress();
    else renderDashboard();
  }

  function addMeta(text) {
    if (!text) return;
    const chip = document.createElement("span");
    chip.textContent = text;
    elements.questionMeta.append(chip);
  }

  function currentQuestion() {
    return sessionQuestions[sessionIndex];
  }

  function renderQuestion() {
    const question = currentQuestion();
    selectedAnswer = null;
    revealedStatus = null;
    elements.studyProgress.textContent = `${sessionIndex + 1} / ${sessionQuestions.length}`;
    elements.progressBar.style.width = `${((sessionIndex + 1) / sessionQuestions.length) * 100}%`;
    elements.questionClassificationDetails.open = false;
    elements.questionMeta.replaceChildren();
    addMeta(question.subject);
    addMeta(question.lecture);
    addMeta(question.professor);
    addMeta(String(question.examYear));
    const path = question.deckId ? deckPathMap().get(question.deckId) : "";
    addMeta(path);
    question.tags.forEach((tag) => addMeta(`#${tag}`));
    elements.questionStem.textContent = question.stem;
    elements.questionImages.replaceChildren();
    question.images.forEach((image, imageIndex) => {
      const figure = document.createElement("figure");
      const picture = document.createElement("img");
      picture.src = image.dataUrl;
      picture.alt = image.altText || `문항 사진 ${imageIndex + 1}`;
      picture.width = image.width;
      picture.height = image.height;
      figure.append(picture);
      if (image.altText) {
        const caption = document.createElement("figcaption");
        caption.textContent = image.altText;
        figure.append(caption);
      }
      elements.questionImages.append(figure);
    });
    elements.questionImages.hidden = question.images.length === 0;
    elements.questionOptions.replaceChildren();

    question.options.forEach((optionText, index) => {
      const answer = index + 1;
      const button = document.createElement("button");
      button.className = "option";
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", "false");
      button.dataset.answer = String(answer);
      const number = document.createElement("i");
      number.textContent = String(answer);
      const text = document.createElement("span");
      text.textContent = optionText;
      button.append(number, text);
      button.addEventListener("click", () => selectAnswer(answer));
      elements.questionOptions.append(button);
    });

    elements.answerActions.hidden = false;
    elements.checkAnswer.disabled = true;
    elements.resultPanel.hidden = true;
    elements.resultPanel.className = "result-panel";
    elements.nextQuestion.textContent = sessionIndex === sessionQuestions.length - 1 ? "풀이 마치기" : "다음 문제";
  }

  function selectAnswer(answer) {
    if (revealedStatus) return;
    selectedAnswer = answer;
    [...elements.questionOptions.children].forEach((button) => {
      const selected = Number(button.dataset.answer) === answer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    elements.checkAnswer.disabled = false;
  }

  async function revealAnswer(markUnknown) {
    const question = currentQuestion();
    if (!markUnknown && selectedAnswer === null) return;
    const status = markUnknown ? "unknown" : selectedAnswer === question.correctAnswer ? "correct" : "incorrect";
    revealedStatus = status;

    [...elements.questionOptions.children].forEach((button) => {
      const answer = Number(button.dataset.answer);
      button.disabled = true;
      button.classList.remove("selected");
      if (answer === question.correctAnswer) button.classList.add("correct-answer");
      if (status === "incorrect" && answer === selectedAnswer) button.classList.add("wrong-answer");
    });

    const previous = progress.get(question.id);
    const record = {
      questionId: question.id,
      status,
      selectedAnswer: markUnknown ? null : selectedAnswer,
      attemptCount: (previous?.attemptCount || 0) + 1,
      lastAnsweredAt: new Date().toISOString(),
    };
    progress.set(question.id, record);
    try {
      await saveProgress(record);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "풀이 기록을 저장하지 못했습니다.", true);
    }

    elements.answerActions.hidden = true;
    elements.resultPanel.classList.add(status);
    elements.resultIcon.textContent = status === "correct" ? "✓" : status === "incorrect" ? "×" : "?";
    elements.resultText.textContent = status === "correct" ? "정답입니다" : status === "incorrect" ? "오답입니다" : "모름으로 기록했습니다";
    elements.correctAnswerText.textContent = `${question.correctAnswer}. ${question.options[question.correctAnswer - 1]}`;
    elements.explanationText.textContent = question.explanation || "등록된 해설이 없습니다.";
    elements.resultPanel.hidden = false;
    updateStats();
    elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function nextQuestion() {
    if (sessionIndex >= sessionQuestions.length - 1) {
      renderStudyReturnView();
      showToast(`${sessionQuestions.length.toLocaleString()}문제 풀이를 마쳤습니다.`);
      return;
    }
    sessionIndex += 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function importBackup(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) throw new Error("파일이 너무 큽니다. 100MB 이하 파일을 선택해 주세요.");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("파일을 읽을 수 없습니다. PC 관리자 화면에서 다시 내보내 주세요.");
    }
    const validated = validateBackup(parsed);
    await saveDataset(validated);
    await removeOrphanedProgress(new Set(validated.questions.map((question) => question.id)));
    dataset = validated;
    const records = await getAllProgress();
    progress = new Map(records.map((record) => [record.questionId, record]));
    populateFilters();
    renderDashboard();
    const imageCount = validated.questions.reduce((sum, question) => sum + question.images.length, 0);
    showToast(`${validated.questions.length.toLocaleString()}문제와 사진 ${imageCount.toLocaleString()}장을 가져왔습니다.`);
  }

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importBackup(file);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "문제 파일을 가져오지 못했습니다.", true);
    }
  }

  async function deleteData() {
    if (!window.confirm("이 iPad에 저장된 문제와 모든 풀이 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    try {
      await clearLocalData();
      dataset = null;
      progress = new Map();
      showView("empty");
      showToast("로컬 데이터를 삭제했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "로컬 데이터를 삭제하지 못했습니다.", true);
    }
  }

  function updateNetworkBadge() {
    if (!navigator.onLine) {
      elements.networkBadge.textContent = "현재 오프라인";
      elements.networkBadge.classList.add("ready");
    } else if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      elements.networkBadge.textContent = "오프라인 사용 가능";
      elements.networkBadge.classList.add("ready");
    } else {
      elements.networkBadge.textContent = "온라인 · 설치 준비 중";
      elements.networkBadge.classList.remove("ready");
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      elements.networkBadge.textContent = "이 브라우저는 설치 미지원";
      return;
    }
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
      elements.networkBadge.textContent = "오프라인 사용 가능";
      elements.networkBadge.classList.add("ready");
    } catch {
      elements.networkBadge.textContent = "온라인으로 실행 중";
    }
  }

  function bindEvents() {
    elements.backupFile.addEventListener("change", handleFileChange);
    elements.subjectFilter.addEventListener("change", () => { populateLectureFilter(); updateMatchedCount(); });
    [elements.lectureFilter, elements.deckFilter, elements.tagFilter].forEach((select) => select.addEventListener("change", updateMatchedCount));
    elements.startAll.addEventListener("click", () => startStudy("all"));
    elements.startIncorrect.addEventListener("click", () => startStudy("incorrect"));
    elements.startUnknown.addEventListener("click", () => startStudy("unknown"));
    elements.openUnitProgress.addEventListener("click", renderUnitProgress);
    elements.leaveUnitProgress.addEventListener("click", renderDashboard);
    elements.deleteAllProgress.addEventListener("click", deleteAllStudyProgress);
    elements.leaveBrowse.addEventListener("click", renderDashboard);
    elements.startBrowseRandom.addEventListener("click", startBrowsedQuestions);
    elements.deleteData.addEventListener("click", deleteData);
    elements.leaveStudy.addEventListener("click", () => {
      if (window.confirm("현재 풀이를 나갈까요? 이미 답한 기록은 저장되어 있습니다.")) renderStudyReturnView();
    });
    elements.markUnknown.addEventListener("click", () => revealAnswer(true));
    elements.checkAnswer.addEventListener("click", () => revealAnswer(false));
    elements.nextQuestion.addEventListener("click", nextQuestion);
    window.addEventListener("online", updateNetworkBadge);
    window.addEventListener("offline", updateNetworkBadge);
  }

  async function init() {
    bindEvents();
    updateNetworkBadge();
    registerServiceWorker();
    try {
      dataset = await getDataset() || null;
      const records = await getAllProgress();
      progress = new Map(records.map((record) => [record.questionId, record]));
      if (dataset) {
        populateFilters();
        renderDashboard();
      } else {
        showView("empty");
      }
    } catch (error) {
      showView("empty");
      showToast(error instanceof Error ? error.message : "로컬 데이터를 불러오지 못했습니다.", true);
    }
  }

  init();
})();
