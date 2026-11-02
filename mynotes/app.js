// Mapeamento otimizado de elementos DOM
const $ = (id) => document.getElementById(id);
const ui = {
  auth: $('auth-view'),
  dashboard: $('dashboard'),
  message: $('message'),
  authForm: $('auth-form'),
  authFields: $('auth-fields'),
  taskForm: $('task-form'),
  taskFields: $('task-fields'),
  list: $('task-list'),
  empty: $('empty'),
  modalOverlay: $('modal-overlay'),
};

let auth, db, authAPI, dbAPI;
let user = null;
let tasks = [];
let unsubscribe = null;
let signingUp = false;
let authBusy = false;
let taskBusy = false;
let ready = false;
let filter = 'all';
let editingId = null;
let activeModalTask = null;

// FORMATAÇÃO UNIFICADA DE DATA (DD/MM/YYYY)
function formatDate(timestamp) {
  const date =
    !timestamp ? new Date()
    : timestamp.toDate ? timestamp.toDate()
    : new Date(timestamp);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// GESTÃO DO POP-UP (MODAL)
function openModal(task) {
  activeModalTask = task;
  $('modal-title').textContent = task.title;
  $('modal-date').textContent = `📅 Criado em: ${formatDate(task.createdAt)}`;
  $('modal-description').textContent =
    task.description || 'Sem descrição cadastrada.';
  ui.modalOverlay.hidden = false;
}

function closeModal() {
  ui.modalOverlay.hidden = true;
  activeModalTask = null;
}

$('modal-close').addEventListener('click', closeModal);
ui.modalOverlay.addEventListener('click', (e) => {
  if (e.target === ui.modalOverlay) closeModal();
});

$('modal-edit-btn').addEventListener('click', () => {
  if (activeModalTask) {
    const taskToEdit = activeModalTask;
    closeModal();
    startEditing(taskToEdit);
  }
});

$('modal-delete-btn').addEventListener('click', () => {
  if (activeModalTask) {
    const taskToDelete = activeModalTask;
    closeModal();
    deleteTask(taskToDelete);
  }
});

// REMOÇÃO REUTILIZÁVEL DE TAREFAS (DRY)
function deleteTask(task) {
  if (
    !window.confirm(
      `Remover a anotação “${task.title}”? Esta ação não pode ser desfeita.`,
    )
  ) {
    return;
  }
  const target = taskReference(task.id);
  void mutate(
    () => dbAPI.deleteDoc(target),
    'Anotação removida.',
    () => {
      if (editingId === task.id) resetEditor();
    },
  );
}

// TOGGLE DE VISIBILIDADE DA SENHA
function initPasswordToggle() {
  document.querySelectorAll('.toggle-password-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = $(targetId);
      const icon = btn.querySelector('.eye-icon');

      if (!input) return;

      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';

      if (icon) {
        icon.textContent = isPassword ? '😑' : '🫥';
      }

      btn.setAttribute(
        'aria-label',
        isPassword ? 'Ocultar senha' : 'Exibir senha',
      );
      btn.setAttribute('title', isPassword ? 'Ocultar senha' : 'Exibir senha');
    });
  });
}

// GESTÃO DE TEMA (LIGHT / DARK)
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);

  const toggleBtn = $('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const currentTheme =
        document.documentElement.getAttribute('data-theme') || 'light';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
      localStorage.setItem('theme', newTheme);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconSpan = document.querySelector('#theme-toggle .theme-icon');
  if (iconSpan) {
    iconSpan.textContent = theme === 'light' ? '🌙' : '☀️';
  }
}

// GESTÃO DE MENSAGENS E ERROS DO FIREBASE
function message(text = '', error = false) {
  if (!ui.message) return;
  ui.message.textContent = text;
  ui.message.hidden = !text;
  ui.message.classList.toggle('error', error);
}

function errorMessage(error) {
  console.error('Erro detalhado do Firebase:', error);
  const messages = {
    'auth/invalid-email': 'Confira o formato do e-mail.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/email-already-in-use':
      'Este e-mail já possui uma conta. Use a opção Entrar.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/password-does-not-meet-requirements':
      'A senha não atende aos requisitos mínimos.',
    'auth/too-many-requests':
      'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed':
      'Não foi possível conectar. Confira sua internet.',
    'auth/operation-not-allowed':
      'Ative o provedor E-mail/senha no Firebase Authentication.',
    'auth/user-disabled': 'Esta conta está desativada.',
    'auth/unauthorized-domain':
      'Autorize este domínio nas configurações do Firebase Authentication.',
    'auth/invalid-api-key': 'Confira a apiKey no arquivo firebase-config.js.',
    'permission-denied':
      'Acesso negado ao banco. Confira as regras do Firestore.',
    'failed-precondition':
      'Confira se o banco Cloud Firestore padrão foi criado.',
    unavailable: 'O banco está indisponível. Confira sua conexão.',
    'not-found': 'Esta anotação não existe mais.',
    'resource-exhausted': 'O limite de uso do serviço foi atingido.',
  };
  return (
    messages[error.code] ||
    `Erro (${error.code || 'desconhecido'}): ${error.message}`
  );
}

// MODOS DE AUTENTICAÇÃO
function setAuthMode(signup) {
  if (authBusy) return;
  signingUp = signup;
  $('login-tab').setAttribute('aria-pressed', String(!signup));
  $('signup-tab').setAttribute('aria-pressed', String(signup));
  $('confirm-group').hidden = !signup;
  $('confirm-password').disabled = !signup;
  $('confirm-password').required = signup;
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('password').minLength = signup ? 6 : 1;
  $('auth-heading').textContent = signup ? 'Crie sua conta' : 'Vamos começar?';
  $('auth-description').textContent =
    signup ?
      'Preencha os campos abaixo para começar.'
    : 'Entre com seu e-mail e senha para acessar suas tarefas.';
  $('auth-submit').textContent =
    signup ? 'Criar minha conta →' : 'Entrar na minha conta →';
  $('password').value = '';
  $('confirm-password').value = '';
}

$('login-tab').addEventListener('click', () => setAuthMode(false));
$('signup-tab').addEventListener('click', () => setAuthMode(true));

ui.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!auth) {
    message('Aguarde a conexão com o Firebase terminar…', true);
    return;
  }
  if (authBusy) return;

  const email = $('email').value.trim();
  const password = $('password').value;

  if (signingUp && password !== $('confirm-password').value) {
    message('As senhas precisam ser iguais.', true);
    $('confirm-password').focus();
    return;
  }

  authBusy = true;
  ui.authFields.disabled = true;
  $('login-tab').disabled = $('signup-tab').disabled = true;
  message(signingUp ? 'Criando sua conta…' : 'Entrando…');

  try {
    if (signingUp) {
      await authAPI.createUserWithEmailAndPassword(auth, email, password);
    } else {
      await authAPI.signInWithEmailAndPassword(auth, email, password);
    }
    ui.authForm.reset();
  } catch (error) {
    message(errorMessage(error), true);
  } finally {
    authBusy = false;
    ui.authFields.disabled = false;
    $('login-tab').disabled = $('signup-tab').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  $('logout').disabled = true;
  try {
    await authAPI.signOut(auth);
  } catch (error) {
    message(errorMessage(error), true);
  } finally {
    $('logout').disabled = taskBusy;
  }
});

// EDITOR DE ANOTAÇÕES
function resetEditor() {
  editingId = null;
  ui.taskForm.reset();
  $('editor-heading').textContent = 'Registrar meta ou tarefa';
  $('save-task').textContent = 'Salvar anotação +';
  $('cancel-edit').hidden = true;
}
$('cancel-edit').addEventListener('click', resetEditor);

function syncControls() {
  ui.taskFields.disabled = taskBusy || !ready;
  $('logout').disabled = taskBusy;
}

function taskReference(id) {
  return dbAPI.doc(db, 'users', user.uid, 'tasks', id);
}

async function mutate(operation, successText, afterSuccess = () => {}) {
  if (!user || !ready || taskBusy) return;
  taskBusy = true;
  syncControls();
  render();
  message('Salvando no Firebase…');
  try {
    await operation();
    afterSuccess();
    message(successText);
  } catch (error) {
    message(errorMessage(error), true);
  } finally {
    taskBusy = false;
    syncControls();
    render();
  }
}

ui.taskForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('task-title').value.trim();
  if (!title) {
    message('Escreva um título para a anotação.', true);
    return;
  }
  if (!user) return;
  const data = {
    title,
    description: $('task-description').value.trim(),
    updatedAt: dbAPI.serverTimestamp(),
  };
  const id = editingId;
  const target =
    id ? taskReference(id) : dbAPI.collection(db, 'users', user.uid, 'tasks');
  void mutate(
    () =>
      id ?
        dbAPI.updateDoc(target, data)
      : dbAPI.addDoc(target, {
          ...data,
          done: false,
          createdAt: dbAPI.serverTimestamp(),
        }),
    id ? 'Anotação atualizada.' : 'Anotação registrada com sucesso.',
    resetEditor,
  );
});

function startEditing(task) {
  editingId = task.id;
  $('task-title').value = task.title;
  $('task-description').value = task.description || '';
  $('editor-heading').textContent = 'Editar anotação';
  $('save-task').textContent = 'Salvar alterações';
  $('cancel-edit').hidden = false;
  $('task-title').focus();
  $('editor-heading').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// RENDERIZAÇÃO PRINCIPAL
function render() {
  const completed = tasks.filter((task) => task.done).length;
  $('total').textContent = tasks.length;
  $('pending').textContent = tasks.length - completed;
  $('completed').textContent = completed;

  const search = $('search').value.trim().toLocaleLowerCase('pt-BR');
  const visible = tasks.filter(
    (task) =>
      (filter === 'all' || (filter === 'done' ? task.done : !task.done)) &&
      `${task.title} ${task.description}`
        .toLocaleLowerCase('pt-BR')
        .includes(search),
  );

  $('visible-count').textContent =
    `${visible.length} ${visible.length === 1 ? 'anotação' : 'anotações'}`;
  ui.empty.hidden = visible.length > 0;
  ui.empty.textContent =
    !ready ? 'Sincronizando com o banco de dados…'
    : tasks.length ? 'Nenhuma anotação corresponde aos filtros.'
    : 'Tudo em dia por aqui! Adicione novas anotações ao lado para manter seu foco.';

  const fragment = document.createDocumentFragment();
  for (const task of visible) {
    const item = makeElement('li', `task${task.done ? ' done' : ''}`);
    const checkbox = makeElement('input', 'task-check');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.disabled = taskBusy || !ready;
    checkbox.setAttribute(
      'aria-label',
      `${task.done ? 'Reabrir' : 'Concluir'} anotação: ${task.title}`,
    );
    checkbox.addEventListener('change', () => {
      const target = taskReference(task.id);
      const done = checkbox.checked;
      void mutate(
        () =>
          dbAPI.updateDoc(target, { done, updatedAt: dbAPI.serverTimestamp() }),
        done ? 'Anotação concluída!' : 'Anotação reaberta.',
      );
    });

    const body = makeElement('div', 'task-body');
    const content = makeElement('div', 'task-content');

    const titleHeading = makeElement(
      'h3',
      'task-title task-title-clickable',
      task.title,
    );
    titleHeading.addEventListener('click', () => openModal(task));
    content.append(titleHeading);

    if (task.description) {
      content.append(makeElement('p', 'task-description', task.description));
    }

    const actions = makeElement('div', 'task-actions');
    const edit = makeElement('button', '', 'Editar');
    edit.type = 'button';
    edit.disabled = taskBusy || !ready;
    edit.setAttribute('aria-label', `Editar anotação: ${task.title}`);
    edit.addEventListener('click', () => startEditing(task));

    const remove = makeElement('button', 'delete', 'Excluir');
    remove.type = 'button';
    remove.disabled = taskBusy || !ready;
    remove.setAttribute('aria-label', `Excluir anotação: ${task.title}`);
    remove.addEventListener('click', () => deleteTask(task));

    actions.append(edit, remove);
    body.append(content, actions);
    item.append(checkbox, body);
    fragment.append(item);
  }
  ui.list.replaceChildren(fragment);
}

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll('[data-filter]')
      .forEach((item) =>
        item.setAttribute('aria-pressed', String(item === button)),
      );
    render();
  });
});

$('search').addEventListener('input', render);

// GESTÃO DE SESSÃO E ESCUTA FIRESTORE
function onSessionChanged(currentUser) {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  user = currentUser;
  tasks = [];
  ready = false;
  taskBusy = false;
  resetEditor();
  $('search').value = '';
  filter = 'all';

  document
    .querySelectorAll('[data-filter]')
    .forEach((item) =>
      item.setAttribute('aria-pressed', String(item.dataset.filter === 'all')),
    );

  ui.auth.hidden = !!user;
  ui.dashboard.hidden = !user;
  $('logout').hidden = !user;
  $('account').textContent = user ? `Conectado como ${user.email}` : '';

  syncControls();
  render();
  message();

  if (!user) return;

  $('sync-status').textContent = 'Conectando…';
  const query = dbAPI.query(
    dbAPI.collection(db, 'users', user.uid, 'tasks'),
    dbAPI.orderBy('createdAt', 'desc'),
  );

  unsubscribe = dbAPI.onSnapshot(
    query,
    { includeMetadataChanges: true },
    (snapshot) => {
      ready = true;
      tasks = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
      if (editingId && !tasks.some((task) => task.id === editingId)) {
        resetEditor();
      }
      $('sync-status').textContent =
        snapshot.metadata.hasPendingWrites ? 'Aguardando gravação…'
        : snapshot.metadata.fromCache ? 'Aguardando conexão…'
        : 'Sincronizado com Firebase';
      syncControls();
      render();
    },
    (error) => {
      ready = false;
      tasks = [];
      syncControls();
      render();
      ui.empty.textContent =
        'Não foi possível carregar suas anotações. Corrija a configuração e atualize a página.';
      $('sync-status').textContent = 'Falha na conexão';
      message(errorMessage(error), true);
    },
  );
}

// INICIALIZAÇÃO DA APLICAÇÃO
async function initialize() {
  initTheme();
  initPasswordToggle();
  ui.authFields.disabled = true;
  message('Conectando aos serviços do Firebase…');
  try {
    const { firebaseConfig } = await import('./firebase-config.js');
    const [appAPI, authentication, firestore] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js'),
    ]);
    authAPI = authentication;
    dbAPI = firestore;
    const app = appAPI.initializeApp(firebaseConfig);
    auth = authAPI.getAuth(app);
    db = dbAPI.getFirestore(app);

    await authAPI.setPersistence(auth, authAPI.browserSessionPersistence);
    authAPI.onAuthStateChanged(auth, onSessionChanged, (error) =>
      message(errorMessage(error), true),
    );

    ui.authFields.disabled = false;
    message('');
  } catch (error) {
    console.error('Falha ao iniciar a aplicação:', error);
    message(
      'Erro ao conectar ao Firebase. Verifique sua conexão e abra pelo Live Server.',
      true,
    );
  }
}

void initialize();
