const fs = require('fs');
const files = ['index.html', 'clients.html', 'storage.html', 'stats.html'];

const navHTML =     <nav>
        <h1>???? Qaff</h1>
        <div class="links">
            <a href="/clients" id="nav-clients">???????</a>
            <a href="/dashboard" id="nav-dashboard">?????? ????????</a>
            <a href="/storage" id="nav-storage">?????? ???????</a>
            <a href="/stats" id="nav-stats">???????? ???????</a>
        </div>
        <div style="display:flex; gap:12px; align-items:center;">
            <button onclick="showAdminPassModal()" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:8px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:16px; transition:0.2s;" title="????? ???? ??????">??</button>
            <button class="logout" onclick="logout()">????? ??????</button>
        </div>
    </nav>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const path = window.location.pathname;
            document.querySelectorAll('.links a').forEach(a => a.classList.remove('active'));
            if (path.includes('clients') || path === '/') document.getElementById('nav-clients').classList.add('active');
            else if (path.includes('dashboard')) document.getElementById('nav-dashboard').classList.add('active');
            else if (path.includes('storage')) document.getElementById('nav-storage').classList.add('active');
            else if (path.includes('stats')) document.getElementById('nav-stats').classList.add('active');
        });
    </script>;

files.forEach(f => {
    const p = 'qaff-admin/public/' + f;
    let text = fs.readFileSync(p, 'utf8');
    text = text.replace(/<nav>[\s\S]*?<\/nav>/, navHTML);
    fs.writeFileSync(p, text);
});
