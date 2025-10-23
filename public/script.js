const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const status = document.getElementById('status');
const meta = document.getElementById('meta');
const fileInfo = document.getElementById('file-info');
const uploadBtn = document.getElementById('uploadBtn');

let chosenFile = null;

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}
['dragenter','dragover','dragleave','drop'].forEach(evt => {
  dropArea.addEventListener(evt, preventDefaults, false);
});

dropArea.addEventListener('dragenter', () => dropArea.classList.add('over'));
dropArea.addEventListener('dragleave', () => dropArea.classList.remove('over'));
dropArea.addEventListener('drop', handleDrop, false);
dropArea.addEventListener('click', () => fileElem.click());

fileElem.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) selectFile(e.target.files[0]);
});

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files.length) selectFile(files[0]);
}

function selectFile(file) {
  if (file.type !== 'application/pdf') {
    status.textContent = 'Please select a PDF.';
    return;
  }
  if (file.size > 20 * 1024 * 1024) { // 20MB
    status.textContent = 'File too large. Max 20 MB.';
    return;
  }
  chosenFile = file;
  fileInfo.textContent = `${file.name} — ${(file.size/1024/1024).toFixed(2)} MB`;
  meta.classList.remove('hidden');
  status.textContent = '';
}

uploadBtn.addEventListener('click', () => {
  if (!chosenFile) return;
  uploadFile(chosenFile);
});

async function uploadFile(file) {
  status.textContent = 'Uploading...';
  const form = new FormData();
  form.append('pdf', file);

  try {
    const resp = await fetch('/upload', { method: 'POST', body: form });
    if (!resp.ok) {
      const json = await resp.json().catch(()=>null);
      status.textContent = json?.error || 'Failed to extract XMP';
      return;
    }
    const cd = resp.headers.get('Content-Disposition') || '';
    let filename = 'xmp.xml';
    const m = cd.match(/filename="(.+)"/);
    if (m) filename = m[1];
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = 'Download started';
  } catch (err) {
    console.error(err);
    status.textContent = 'Network or server error';
  }
}
