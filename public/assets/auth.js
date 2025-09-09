(function(){
    function get(){ return localStorage.getItem('staff_key') || ''; }
    function set(k){ localStorage.setItem('staff_key', k || ''); }
    function clear(){ localStorage.removeItem('staff_key'); }
    function gotoLogin(){ location.href = 'login.html'; }
  
    // Лека проверка към бекенда (по желание)
    async function verify(key){
      try{
        const r = await fetch('/api/staff/verify?key='+encodeURIComponent(key));
        return r.ok;
      }catch{ return false; }
    }
  
    async function require(){ // проверява, при липса — пренасочва към login
      const k = get();
      if(!k){ gotoLogin(); throw new Error('no-key'); }
      return k; // можеш да включиш и await verify(k) ако желаеш твърда проверка
    }
  
    function logout(){ clear(); gotoLogin(); }
  
    // attach logout към бутон по id
    function attachLogout(btnId){
      const b = document.getElementById(btnId);
      if(!b) return;
      b.addEventListener('click', logout);
    }
  
    window.staffAuth = { get, set, clear, require, verify, logout, attachLogout };
  })();
  