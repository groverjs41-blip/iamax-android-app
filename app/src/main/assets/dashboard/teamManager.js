export const DB = {
  miembros: [
    { nombre: "justinfarinasramos7...", id: "1981599026909233153", obs: "--", grupoPerfiles: "Todos los grupos", rol: "Super Admin", grupoMiembros: "Grupo Superadmin", estado: "Activando", ultimo: "2026-06-20 02:53:28", superAdmin: true },
    { nombre: "carloscg", id: "2067013155962163201", obs: "--", grupoPerfiles: "IA Premiun IAm...", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Activando", ultimo: "2026-06-16 21:01:47" },
    { nombre: "Tomas", id: "2066908102664302594", obs: "--", grupoPerfiles: "IA Premiun IAmax 3", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Activando", ultimo: "2026-06-16 11:47:52" },
    { nombre: "Aldo Apaza", id: "2066670991306620929", obs: "--", grupoPerfiles: "IA Leonardo 4 en to", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Activando", ultimo: "2026-06-15 20:23:48" },
    { nombre: "Yerry", id: "2066256286893150209", obs: "--", grupoPerfiles: "IA Leonardo 4 en to", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Activando", ultimo: "2026-06-20 21:19:17" },
    { nombre: "nirgo.26", id: "2065929901658017793", obs: "--", grupoPerfiles: "IA Premiun IAmax 3", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Desactivado", ultimo: "2026-06-14 08:23:36" },
    { nombre: "Angel Barba", id: "2065548858367115265", obs: "--", grupoPerfiles: "IA Leonardo 4 en to", rol: "Personal (Miembro Interno)", grupoMiembros: "grupo gpt", estado: "Activando", ultimo: "2026-06-12 23:39:34" }
  ]
};

let initialized = false;
let editingMemberId = null;

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function roleToRadioValue(role = "") {
  if (role.includes("Super") || role.includes("Admin")) return "Admin";
  if (role.includes("Gerente")) return "Gerente";
  return "Personal";
}

function radioValueToRole(value, member) {
  if (member?.superAdmin) return "Super Admin";
  if (value === "Personal") return "Personal (Miembro Interno)";
  return value || "Personal (Miembro Interno)";
}

function setSelectValue(select, value) {
  if (!select) return;
  const targetValue = value || "Todos los grupos";
  const hasOption = [...select.options].some((option) => option.value === targetValue || option.textContent === targetValue);
  if (!hasOption) {
    select.appendChild(new Option(targetValue, targetValue));
  }
  select.value = targetValue;
}

export function initTeamManager() {
  if (initialized) {
    renderMembers();
    return;
  }

  initialized = true;
  wireScopedTabs();
  wireMemberModal();
  renderMembers();
}

function wireScopedTabs() {
  document.querySelectorAll(".dic-tabs").forEach((tabList) => {
    if (tabList.dataset.bound === "true") return;
    tabList.dataset.bound = "true";

    const ownerSection = tabList.closest(".owner-section") || document;
    const tabs = [...tabList.querySelectorAll(".dic-tab")];
    const contents = [...ownerSection.querySelectorAll(".dic-tab-content")]
      .filter((content) => content.parentElement === ownerSection);

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const key = tab.dataset.tab || "";
        const target = contents.find((content) => (
          content.id === `tab-${key}` || content.id === `ext-tab-${key}`
        ));

        tabs.forEach((item) => item.classList.toggle("active", item === tab));
        contents.forEach((content) => content.classList.toggle("active", content === target));
      });
    });
  });
}

function renderMembers() {
  const tbody = document.getElementById("memberTableBody");
  if (!tbody) return;

  tbody.innerHTML = DB.miembros.map((member) => {
    const estadoClass = member.estado === "Activando" ? "ok" : "err";
    const memberId = escapeHtml(member.id);
    const deleteButton = member.superAdmin
      ? ""
      : `<span class="del-member" data-id="${memberId}" title="Eliminar">&#128465;</span>`;

    return `
      <tr>
        <td><input type="checkbox"></td>
        <td><div class="info-main">${escapeHtml(member.nombre)}</div><div class="info-id">ID: ${memberId}</div></td>
        <td>${escapeHtml(member.obs || "--")}</td>
        <td>${escapeHtml(member.grupoPerfiles)}${member.superAdmin ? "" : '<br><a class="ver">Ver</a>'}</td>
        <td>${escapeHtml(member.rol)}</td>
        <td>${escapeHtml(member.grupoMiembros)}</td>
        <td><span class="status ${estadoClass}">● ${escapeHtml(member.estado)}</span></td>
        <td>${escapeHtml(member.ultimo)}</td>
        <td class="ops"><span class="edit-member" data-id="${memberId}" title="Editar">&#9998;</span><span title="Refrescar">&#8635;</span>${deleteButton}</td>
      </tr>`;
  }).join("");

  const total = document.getElementById("memberTotal");
  if (total) total.textContent = DB.miembros.length;

  tbody.querySelectorAll(".del-member").forEach((button) => {
    button.addEventListener("click", () => {
      DB.miembros = DB.miembros.filter((member) => member.id !== button.dataset.id);
      renderMembers();
    });
  });

  tbody.querySelectorAll(".edit-member").forEach((button) => {
    button.addEventListener("click", () => {
      const member = DB.miembros.find((item) => item.id === button.dataset.id);
      if (member) openMemberModal(member);
    });
  });
}

function wireMemberModal() {
  const modal = document.getElementById("memberModal");
  const close = () => {
    editingMemberId = null;
    modal?.classList.remove("open");
  };

  document.querySelectorAll("#btnCrearMiembro").forEach((button) => {
    button.addEventListener("click", () => openMemberModal());
  });

  document.getElementById("modalClose")?.addEventListener("click", close);
  document.getElementById("modalCancel")?.addEventListener("click", close);

  modal?.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  document.getElementById("genPwd")?.addEventListener("click", (event) => {
    event.preventDefault();
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let password = "";
    for (let i = 0; i < 12; i += 1) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }

    const input = document.getElementById("memberPwd");
    if (input) input.value = password;
  });

  document.getElementById("modalConfirm")?.addEventListener("click", () => {
    if (!modal) return;
    const member = DB.miembros.find((item) => item.id === editingMemberId);
    const nameInput = document.getElementById("memberName");
    const userInput = document.getElementById("memberUser");
    const pwdInput = document.getElementById("memberPwd");
    const groupSelect = document.getElementById("memberProfileGroup");
    const roleValue = [...modal.querySelectorAll("input[name=rol]")]
      .find((input) => input.checked)?.value || "Personal";
    const username = userInput?.value.trim() || "";

    if (!username) {
      alert("Por favor ingrese un usuario.");
      return;
    }

    const updates = {
      nombre: nameInput?.value.trim() || username,
      usuario: username,
      password: pwdInput?.value || "",
      grupoPerfiles: groupSelect?.value || "Todos los grupos",
      rol: radioValueToRole(roleValue, member)
    };

    if (member) {
      Object.assign(member, updates);
      renderMembers();
      close();
      alert("Miembro actualizado correctamente.");
      return;
    }

    DB.miembros.unshift({
      ...updates,
      id: Date.now().toString().slice(0, 16),
      obs: "--",
      grupoMiembros: "Equipo Base",
      estado: "Activando",
      ultimo: "--"
    });

    renderMembers();
    close();
    alert("Miembro de equipo creado correctamente.");
  });
}

function openMemberModal(member = null) {
  const modal = document.getElementById("memberModal");
  if (!modal) return;

  editingMemberId = member?.id || null;
  const title = document.getElementById("memberModalTitle");
  const nameInput = document.getElementById("memberName");
  const userInput = document.getElementById("memberUser");
  const pwdInput = document.getElementById("memberPwd");
  const groupSelect = document.getElementById("memberProfileGroup");
  const roleValue = roleToRadioValue(member?.rol || "");

  if (title) title.textContent = member ? "Editar miembro interno" : "Añadir miembro interno";
  if (nameInput) nameInput.value = member?.nombre || "";
  if (userInput) userInput.value = member?.usuario || member?.nombre || "";
  if (pwdInput) pwdInput.value = member?.password || "";
  setSelectValue(groupSelect, member?.grupoPerfiles || "Todos los grupos");

  const roleInput = modal.querySelector(`input[name=rol][value="${roleValue}"]`);
  if (roleInput) roleInput.checked = true;
  modal.classList.add("open");
}
