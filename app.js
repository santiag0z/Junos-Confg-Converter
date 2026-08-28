document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("file-input");
  const dropZone = document.getElementById("drop-zone");
  const output = document.getElementById("output");
  const formatButtons = document.querySelectorAll(".btn-format");
  const btnCopy = document.getElementById("btn-copy");
  const btnDownload = document.getElementById("btn-download");
  const uploadLabel = document.getElementById("upload-label");

  let rawTextContent = "";
  let parsedData = null;
  let selectedFormat = "set";

  // Event Listeners dos Botões de Ação
  btnCopy.addEventListener("click", copyToClipboard);
  btnDownload.addEventListener("click", downloadFile);

  // Event Listener de Upload via Clique na Área
  dropZone.addEventListener("click", (e) => {
    // Evita loop infinito se o próprio input for clicado
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", handleFileSelect);

  // Gerenciador dos Botões de Formato (Pills SET, JSON, XML)
  formatButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      // Garante captura do botão correto mesmo se clicar no elemento interno
      const targetBtn = e.target.closest(".btn-format");
      if (!targetBtn) return;

      formatButtons.forEach((btn) => btn.classList.remove("active"));
      targetBtn.classList.add("active");
      selectedFormat = targetBtn.getAttribute("data-format");

      // Atualiza dinamicamente a mensagem de tooltip ao passar o mouse
      btnDownload.title = `Download ${selectedFormat} file`;

      renderOutput();
    });
  });

  // Drag & Drop Handling
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "#ffffff";
    dropZone.style.background = "rgba(255, 255, 255, 0.15)";
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.style.borderColor = "rgba(255, 255, 255, 0.3)";
    dropZone.style.background = "rgba(0, 0, 0, 0.1)";
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.borderColor = "rgba(255, 255, 255, 0.3)";
    dropZone.style.background = "rgba(0, 0, 0, 0.1)";

    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelect();
    }
  });

  function handleFileSelect() {
    const file = fileInput.files[0];
    if (!file) return;

    uploadLabel.innerText = `Selected File: ${file.name}`;

    const reader = new FileReader();
    reader.onload = function (e) {
      rawTextContent = e.target.result;
      parsedData = parseJunosToAST(rawTextContent);
      renderOutput();

      // Habilita os botões de ação após leitura válida
      btnCopy.disabled = false;
      btnDownload.disabled = false;
    };
    reader.readAsText(file);
  }

  // Parser AST da configuração Junos OS
  function parseJunosToAST(text) {
    const lines = text.split("\n");
    const root = { type: "root", children: [] };
    const stack = [root];

    for (let line of lines) {
      line = line.replace(/##.*/, "").trim();
      if (!line) continue;

      if (line.startsWith("version ")) {
        const verVal = line.replace("version ", "").replace(";", "").trim();
        stack[stack.length - 1].children.push({
          type: "version",
          value: verVal,
        });
        continue;
      }

      if (line.endsWith("{")) {
        let header = line.substring(0, line.length - 1).trim();
        let isInactive = false,
          isProtect = false;

        if (header.startsWith("inactive:")) {
          isInactive = true;
          header = header.replace(/^inactive:\s*/, "");
        } else if (header.startsWith("protect:")) {
          isProtect = true;
          header = header.replace(/^protect:\s*/, "");
        }

        const node = {
          type: "block",
          name: header,
          isInactive,
          isProtect,
          children: [],
        };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        continue;
      }

      if (line === "}") {
        if (stack.length > 1) stack.pop();
        continue;
      }

      if (line.endsWith(";")) {
        let stmt = line.substring(0, line.length - 1).trim();
        let isInactive = false,
          isProtect = false;

        if (stmt.startsWith("inactive:")) {
          isInactive = true;
          stmt = stmt.replace(/^inactive:\s*/, "");
        } else if (stmt.startsWith("protect:")) {
          isProtect = true;
          stmt = stmt.replace(/^protect:\s*/, "");
        }

        if (stmt.includes("[") && stmt.includes("]")) {
          const match = stmt.match(/^(.*?)\s*\[\s*(.*?)\s*\]$/);
          if (match) {
            const key = match[1].trim();
            const items = match[2].split(/\s+/).filter(Boolean);
            stack[stack.length - 1].children.push({
              type: "list_statement",
              key,
              items,
              isInactive,
              isProtect,
            });
            continue;
          }
        }

        stack[stack.length - 1].children.push({
          type: "statement",
          text: stmt,
          isInactive,
          isProtect,
        });
      }
    }
    return root;
  }

  // Renderizador da saída no Textarea
  function renderOutput() {
    if (!parsedData) return;

    if (selectedFormat === "set") {
      output.value = generateSet(parsedData);
    } else if (selectedFormat === "json") {
      output.value = JSON.stringify(generateJSONObject(parsedData), null, 4);
    } else if (selectedFormat === "xml") {
      output.value = generateXML(parsedData);
    }
  }

  // Gerador do formato SET
  function generateSet(ast) {
    const commands = [];

    function traverse(node, pathStack) {
      for (const child of node.children) {
        if (child.type === "version") {
          commands.push(`set version ${child.value}`);
        } else if (child.type === "block") {
          const newPath = [...pathStack, child.name];
          const currentPathStr = newPath.join(" ");

          if (child.isInactive) commands.push(`deactivate ${currentPathStr}`);
          if (child.isProtect) commands.push(`protect ${currentPathStr}`);

          traverse(child, newPath);
        } else if (child.type === "statement") {
          const prefix = child.isInactive
            ? "deactivate"
            : child.isProtect
              ? "protect"
              : "set";
          const currentPathStr = pathStack.join(" ");
          const fullPath = currentPathStr
            ? `${currentPathStr} ${child.text}`
            : child.text;
          commands.push(`${prefix} ${fullPath}`);
        } else if (child.type === "list_statement") {
          const prefix = child.isInactive
            ? "deactivate"
            : child.isProtect
              ? "protect"
              : "set";
          const currentPathStr = pathStack.join(" ");
          for (const item of child.items) {
            const fullPath = currentPathStr
              ? `${currentPathStr} ${child.key} ${item}`
              : `${child.key} ${item}`;
            commands.push(`${prefix} ${fullPath}`);
          }
        }
      }
    }

    traverse(ast, []);
    return commands.join("\n");
  }

  // Gerador do formato JSON
  function generateJSONObject(ast) {
    function nodeToObj(node) {
      const obj = {};

      for (const child of node.children) {
        if (child.type === "version") {
          obj["version"] = child.value;
        } else if (child.type === "block") {
          let key = child.name;
          if (child.isInactive) key = `inactive:${key}`;
          if (child.isProtect) key = `protect:${key}`;

          const childObj = nodeToObj(child);
          if (obj[key]) {
            if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
            obj[key].push(childObj);
          } else {
            obj[key] = childObj;
          }
        } else if (child.type === "statement") {
          let text = child.text;
          let prefix = child.isInactive
            ? "inactive:"
            : child.isProtect
              ? "protect:"
              : "";

          const spaceIdx = text.indexOf(" ");
          if (spaceIdx !== -1) {
            const k = prefix + text.substring(0, spaceIdx);
            const v = text.substring(spaceIdx + 1).replace(/^"(.*)"$/, "$1");
            obj[k] = v;
          } else {
            obj[prefix + text] = true;
          }
        } else if (child.type === "list_statement") {
          let prefix = child.isInactive
            ? "inactive:"
            : child.isProtect
              ? "protect:"
              : "";
          obj[prefix + child.key] = child.items;
        }
      }
      return obj;
    }

    return { configuration: nodeToObj(ast) };
  }

  // Gerador do formato XML
  function generateXML(ast) {
    function sanitizeTag(name) {
      let tag = name.split(/\s+/)[0];
      tag = tag.replace(/[^a-zA-Z0-9_\-]/g, "_");
      if (/^[0-9]/.test(tag)) tag = "_" + tag;
      return tag || "item";
    }

    function buildXmlNodes(node, indent = "  ") {
      let xml = "";

      for (const child of node.children) {
        if (child.type === "version") {
          xml += `${indent}<version>${child.value}</version>\n`;
        } else if (child.type === "block") {
          const parts = child.name.split(/\s+/);
          const mainTag = sanitizeTag(parts[0]);
          let attr = "";
          if (child.isInactive) attr += ' inactive="inactive"';
          if (child.isProtect) attr += ' protect="protect"';

          if (parts.length > 1) {
            const nameVal = parts
              .slice(1)
              .join(" ")
              .replace(/^"(.*)"$/, "$1");
            xml += `${indent}<${mainTag}${attr}>\n`;
            xml += `${indent}  <name>${nameVal}</name>\n`;
            xml += buildXmlNodes(child, indent + "  ");
            xml += `${indent}</${mainTag}>\n`;
          } else {
            xml += `${indent}<${mainTag}${attr}>\n`;
            xml += buildXmlNodes(child, indent + "  ");
            xml += `${indent}</${mainTag}>\n`;
          }
        } else if (child.type === "statement") {
          let text = child.text;
          let attr = "";
          if (child.isInactive) attr += ' inactive="inactive"';
          if (child.isProtect) attr += ' protect="protect"';

          const spaceIdx = text.indexOf(" ");
          if (spaceIdx !== -1) {
            const tag = sanitizeTag(text.substring(0, spaceIdx));
            const val = text.substring(spaceIdx + 1).replace(/^"(.*)"$/, "$1");
            xml += `${indent}<${tag}${attr}>${escapeXml(val)}</${tag}>\n`;
          } else {
            const tag = sanitizeTag(text);
            xml += `${indent}<${tag}${attr}/>\n`;
          }
        } else if (child.type === "list_statement") {
          const tag = sanitizeTag(child.key);
          let attr = "";
          if (child.isInactive) attr += ' inactive="inactive"';
          if (child.isProtect) attr += ' protect="protect"';

          for (const item of child.items) {
            xml += `${indent}<${tag}${attr}>${escapeXml(item)}</${tag}>\n`;
          }
        }
      }
      return xml;
    }

    function escapeXml(unsafe) {
      return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case "<":
            return "&lt;";
          case ">":
            return "&gt;";
          case "&":
            return "&amp;";
          case "'":
            return "&apos;";
          case '"':
            return "&quot;";
        }
      });
    }

    return `<?xml version="1.0" encoding="UTF-8"?>\n<configuration>\n${buildXmlNodes(ast, "  ")}</configuration>`;
  }

  async function copyToClipboard() {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);

      // Feedback visual no ícone ao copiar
      const copyIcon = btnCopy.querySelector("i");
      copyIcon.className = "fa-solid fa-check";
      setTimeout(() => {
        copyIcon.className = "fa-solid fa-copy";
      }, 2000);
    } catch (err) {
      output.select();
      document.execCommand("copy");
    }
  }

  function downloadFile() {
    if (!output.value) return;

    const extMap = { set: "set", json: "json", xml: "xml" };
    const mimeMap = {
      set: "text/plain",
      json: "application/json",
      xml: "application/xml",
    };

    const blob = new Blob([output.value], { type: mimeMap[selectedFormat] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `junos_config.${extMap[selectedFormat]}`;
    a.click();
    URL.revokeObjectURL(url);
  }
});
