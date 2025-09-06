
/**
 * Lightweight Ludo in ~600 lines.
 * Canvas-based. 2–4 players. Human + optional bots.
 * Rules covered:
 * - Need 6 to leave base, extra roll on 6 (max 3 chained sixes -> turn forfeited)
 * - Captures on non-safe tiles. Safe tiles + stacked same-color are safe.
 * - Individual home paths per color; exact roll to finish.
 * - Win when all 4 tokens reach home.
 *
 * This is a teaching/demo build, optimized for readability over micro-performance.
 */

const cfg = {
  size: 720,
  grid: 15,            // Ludo board 15x15
  cell: 48,            // 720 / 15 = 48px
  tokenR: 16,
  safeIdx: [0,8,13,21,26,34,39,47], // standard safe positions on main track
  colors: [
    { name: "Red",    base: "#e43d3d", dark: "#a32323"},
    { name: "Green",  base: "#41b35d", dark: "#2e8c47"},
    { name: "Yellow", base: "#f0c541", dark: "#b7911d"},
    { name: "Blue",   base: "#4475ff", dark: "#2f4cc2"},
  ],
};

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const rollBtn = document.getElementById("rollBtn");
const diceFace = document.getElementById("diceFace");
const turnInfo = document.getElementById("turnInfo");
const newGameBtn = document.getElementById("newGame");
const playerCountSel = document.getElementById("playerCount");
const botCountSel = document.getElementById("botCount");

let G = null; // global game state

// --- Geometry helpers -------------------------------------------------------
function cellRect(c,r) {
  const s = cfg.cell;
  return {x: c*s, y: r*s, w: s, h: s};
}
function circle(x,y,r) {
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.closePath();
}
function centerOfCell(c,r) {
  const s = cfg.cell;
  return {x: c*s + s/2, y: r*s + s/2};
}

// --- Board model ------------------------------------------------------------
// Build coordinates for the 52 main track positions and each color's 6 home cells.
// We'll use arrays of [col,row] grid coordinates that match the visual 15x15 layout.
const Board = (()=>{

  // Precomputed coordinates from a standard 15x15 Ludo layout.
  // Main outer track starting at Red entry and going clockwise.
  const main = [
    // Red start at (6,14) upward
    [6,14],[6,13],[6,12],[6,11],[6,10],[5,9],[4,9],[3,9],[2,9],[1,9],[0,9],[0,8],
    [0,7],[1,7],[2,7],[3,7],[4,7],[5,6],[6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
    [7,0],[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[9,6],[10,7],[11,7],[12,7],[13,7],[14,7],
    [14,8],[14,9],[13,9],[12,9],[11,9],[10,9],[9,9],[8,10],[8,11],[8,12],[8,13],[8,14],
    [7,14],[7,13],
  ]; // length 52

  // Entry index to each home path
  const entryIdx = [1, 14, 27, 40]; // indexes where each color turns into their home

  // Home paths (6 cells) for each color
  const homePaths = [
    // Red: from (7,13) to (7,8)
    [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    // Green: from (1,7) to (6,7)
    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    // Yellow: from (7,1) to (7,6)
    [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    // Blue: from (13,7) to (8,7)
    [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
  ];

  // Base positions (four per color)
  const bases = [
    [[1,13],[3,13],[1,11],[3,11]],   // Red
    [[1,3],[3,3],[1,1],[3,1]],       // Green
    [[11,3],[13,3],[11,1],[13,1]],   // Yellow
    [[11,13],[13,13],[11,11],[13,11]]// Blue
  ];

  // Starting squares where a 6 places the token
  const starts = [[6,13],[1,8],[8,1],[13,8]];

  // Safe tiles indexes on main track (plus stacks of same color are safe)
  const safeIdx = cfg.safeIdx;

  return { main, homePaths, entryIdx, bases, starts, safeIdx };

})();

// --- Game state -------------------------------------------------------------
function makeGame(players=2, bots=0) {
  const order = [0,1,2,3].slice(0, players);
  const actors = order.map((i, idx) => ({
    id: i,
    name: cfg.colors[i].name,
    color: cfg.colors[i],
    isBot: idx < bots, // first N players become bots
    tokens: [ {state:"base", mainIdx:null, homeIdx:null},
              {state:"base", mainIdx:null, homeIdx:null},
              {state:"base", mainIdx:null, homeIdx:null},
              {state:"base", mainIdx:null, homeIdx:null} ],
    finished: 0,
  }));
  return {
    players: actors,
    turn: 0,
    dice: null,
    rollsInTurn: 0,
    history: [],
    winner: null,
    hover: null,
  };
}

// --- Rendering --------------------------------------------------------------
function drawBoard() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Background grid (light)
  for (let r=0;r<cfg.grid;r++){
    for (let c=0;c<cfg.grid;c++){
      const {x,y,w,h} = cellRect(c,r);
      ctx.fillStyle = ((r===6||r===8)||(c===6||c===8)) ? "#151523" : "#10101a";
      ctx.fillRect(x,y,w,h);
    }
  }

  // Draw colored homes
  function fillCells(cells, color) {
    ctx.fillStyle = color;
    cells.forEach(([c,r])=>{
      const {x,y,w,h} = cellRect(c,r);
      ctx.fillRect(x,y,w,h);
    });
  }

  // corner squares (5x5 areas) — tint with team color subtle
  fillCells([[0,10],[1,10],[2,10],[3,10],[4,10],
             [0,11],[1,11],[2,11],[3,11],[4,11],
             [0,12],[1,12],[2,12],[3,12],[4,12],
             [0,13],[1,13],[2,13],[3,13],[4,13],
             [0,14],[1,14],[2,14],[3,14],[4,14]], "#38191c"); // red corner

  fillCells([[0,0],[1,0],[2,0],[3,0],[4,0],
             [0,1],[1,1],[2,1],[3,1],[4,1],
             [0,2],[1,2],[2,2],[3,2],[4,2],
             [0,3],[1,3],[2,3],[3,3],[4,3],
             [0,4],[1,4],[2,4],[3,4],[4,4]], "#17321f"); // green corner

  fillCells([[10,0],[11,0],[12,0],[13,0],[14,0],
             [10,1],[11,1],[12,1],[13,1],[14,1],
             [10,2],[11,2],[12,2],[13,2],[14,2],
             [10,3],[11,3],[12,3],[13,3],[14,3],
             [10,4],[11,4],[12,4],[13,4],[14,4]], "#3a3313"); // yellow corner

  fillCells([[10,10],[11,10],[12,10],[13,10],[14,10],
             [10,11],[11,11],[12,11],[13,11],[14,11],
             [10,12],[11,12],[12,12],[13,12],[14,12],
             [10,13],[11,13],[12,13],[13,13],[14,13],
             [10,14],[11,14],[12,14],[13,14],[14,14]], "#18243d"); // blue corner

  // Draw main path cells
  Board.main.forEach(([c,r], idx)=>{
    const {x,y,w,h} = cellRect(c,r);
    ctx.fillStyle = "#1b1b2a";
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle = "#2a2a3e";
    ctx.lineWidth = 1;
    ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);

    // safe star
    if (Board.safeIdx.includes(idx)) {
      ctx.fillStyle = "#d6d6ea";
      ctx.font = "18px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", x+w/2, y+h/2);
    }
  });

  // Home paths
  Board.homePaths.forEach((path, i)=>{
    ctx.fillStyle = cfg.colors[i].dark;
    path.forEach(([c,r])=>{
      const {x,y,w,h} = cellRect(c,r);
      ctx.fillRect(x,y,w,h);
      ctx.strokeStyle = "#2a2a3e";
      ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
    });
  });

  // Center home
  ([ [6,6],[7,6],[8,6],
     [6,7],[7,7],[8,7],
     [6,8],[7,8],[8,8] ]).forEach(([c,r])=>{
    const {x,y,w,h} = cellRect(c,r);
    ctx.fillStyle = "#1b1b2a";
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle = "#2a2a3e";
    ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  });

  // Bases circles
  Board.bases.forEach((cells, i)=>{
    cells.forEach(([c,r])=>{
      const {x,y,w,h} = cellRect(c,r);
      const cx = x+w/2, cy = y+h/2;
      ctx.fillStyle = cfg.colors[i].base + "cc";
      circle(cx,cy,18); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#090912";
      ctx.stroke();
    });
  });

  // Start markers
  Board.starts.forEach(([c,r], i)=>{
    const {x,y,w,h} = cellRect(c,r);
    ctx.fillStyle = cfg.colors[i].base;
    ctx.fillRect(x+8,y+8,w-16,h-16);
  });
}

function drawTokens() {
  // Draw tokens for each player
  const stacks = {}; // key -> array of {p, t}
  function keyForPos(pos) { return pos ? `${pos.type}-${pos.index}-${pos.owner??""}` : "base"; }

  G.players.forEach((pl, pi)=>{
    pl.tokens.forEach((tk, ti)=>{
      let pos = null;
      if (tk.state === "base") {
        // Draw in base cells
        const [c,r] = Board.bases[pl.id][ti];
        const {x,y,w,h} = cellRect(c,r);
        const cx = x+w/2, cy = y+h/2;
        drawToken(cx,cy,pl, true);
        return;
      } else if (tk.state === "main") {
        const [c,r] = Board.main[tk.mainIdx];
        pos = {type:"main", index: tk.mainIdx};
        pushStack(stacks, pos, {pl,pi,tk,ti,c,r});
      } else if (tk.state === "homepath") {
        const [c,r] = Board.homePaths[pl.id][tk.homeIdx];
        pos = {type:"home", index: tk.homeIdx, owner: pl.id};
        pushStack(stacks, pos, {pl,pi,tk,ti,c,r});
      } else if (tk.state === "finished") {
        // finished tokens sit in center home
        const centers = [[6.5,6.5],[7.5,6.5],[6.5,7.5],[7.5,7.5]];
        const [cx,cy] = centers[ti];
        drawToken(cx*cfg.cell, cy*cfg.cell, pl, false, true);
        return;
      }
    });
  });

  // draw stacks, offset slightly
  Object.values(stacks).forEach(arr=>{
    arr.forEach((o, idx)=>{
      const {x,y,w,h} = cellRect(o.c,o.r);
      const cx = x+w/2 + (idx*6);
      const cy = y+h/2 + (idx*6);
      drawToken(cx,cy,o.pl, false);
    });
  });

  function pushStack(map, pos, item){
    const key = keyForPos(pos);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }

  function drawToken(x,y,pl, inBase=false, finished=false){
    ctx.save();
    // shadow
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#00000055";
    circle(x+2,y+4, cfg.tokenR); ctx.fill();
    ctx.globalAlpha = 1;
    // body
    const grad = ctx.createRadialGradient(x-6,y-6,6, x,y, cfg.tokenR);
    grad.addColorStop(0, pl.color.base);
    grad.addColorStop(1, pl.color.dark);
    ctx.fillStyle = grad;
    circle(x,y, cfg.tokenR); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = inBase ? "#ffffffaa" : "#0b0b12";
    ctx.stroke();
    // crown for finished
    if (finished) {
      ctx.fillStyle = "#ffd95e";
      ctx.font = "18px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("👑", x, y);
    }
    ctx.restore();
  }
}

// --- Turn + Rules -----------------------------------------------------------
function currentPlayer(){ return G.players[G.turn]; }

function hasMoves(pl, dice){
  // any token that can move?
  return pl.tokens.some(tk=> legalMovesForToken(pl, tk, dice) > 0);
}

function legalMovesForToken(pl, tk, dice){
  if (tk.state === "finished") return 0;
  if (tk.state === "base") return (dice === 6) ? 1 : 0;
  if (tk.state === "main") {
    let idx = tk.mainIdx;
    // moving along main then maybe entering home
    let stepsToEntry = (Board.entryIdx[pl.id] - idx + 52) % 52;
    if (dice <= stepsToEntry) return 1; // stay on main
    const intoHome = dice - stepsToEntry - 1;
    return (intoHome <= 5) ? 1 : 0; // exact within 0..5 allowed
  }
  if (tk.state === "homepath") {
    const remaining = 5 - tk.homeIdx;
    return (dice <= remaining+1) ? 1 : 0; // exact to finish
  }
  return 0;
}

function applyMove(pl, tokenIndex, dice){
  const tk = pl.tokens[tokenIndex];

  if (tk.state === "base") {
    // move onto starting square
    tk.state = "main";
    tk.mainIdx = (Board.entryIdx[pl.id] + 51) % 52; // cell just before entry so +1 step is entry
    tk.mainIdx = (tk.mainIdx + 1) % 52; // actually place on start (visual)
    tk.mainIdx = Board.entryIdx[pl.id]; // place at entry cell
    captureIfPossible(pl, tk);
    return {type:"enter"};
  }

  if (tk.state === "main") {
    const before = tk.mainIdx;
    let idx = tk.mainIdx;
    let stepsToEntry = (Board.entryIdx[pl.id] - idx + 52) % 52;
    if (dice <= stepsToEntry) {
      tk.mainIdx = (tk.mainIdx + dice) % 52;
      const cap = captureIfPossible(pl, tk);
      return {type:"move", captured: cap};
    } else {
      // move to entry, then into home path
      tk.mainIdx = Board.entryIdx[pl.id];
      const intoHome = dice - stepsToEntry - 1;
      tk.state = "homepath";
      tk.homeIdx = intoHome; // 0-based
      return {type:"enter-home", at: tk.homeIdx};
    }
  }

  if (tk.state === "homepath") {
    let newIdx = tk.homeIdx + dice;
    if (newIdx === 5) {
      // finish
      tk.state = "finished";
      tk.homeIdx = null;
      currentPlayer().finished += 1;
      return {type:"finish"};
    } else {
      tk.homeIdx = newIdx;
      return {type:"move-home", to: newIdx};
    }
  }
}

function sameTeamStackAt(plId, where){
  // returns count of same-team tokens at cell where = {type:"main"/"home", index, owner?}
  let count = 0;
  G.players.forEach((pl, pid)=>{
    pl.tokens.forEach(tk=>{
      if (tk.state === "main" && where.type==="main" && tk.mainIdx===where.index && pid===plId) count++;
      if (tk.state === "homepath" && where.type==="home" && tk.homeIdx===where.index && pid===plId) count++;
    });
  });
  return count;
}

function captureIfPossible(pl, tk){
  // Only on main track, not on safe tiles, and only if opponent not stacked on safe
  if (tk.state !== "main") return null;
  const idx = tk.mainIdx;
  if (Board.safeIdx.includes(idx)) return null;

  // count how many opponents here
  const victims = [];
  G.players.forEach((opl, pid)=>{
    if (pid===G.players.indexOf(pl)) return;
    opl.tokens.forEach((otk, oti)=>{
      if (otk.state==="main" && otk.mainIdx===idx){
        victims.push({pid, oti, opl});
      }
    });
  });

  // cannot capture if opponent has a stack >=2 (stack protected)
  if (victims.length >= 2) return null;

  if (victims.length > 0) {
    victims.forEach(v=>{
      const otk = G.players[v.pid].tokens[v.oti];
      // send back to base
      otk.state="base"; otk.mainIdx=null; otk.homeIdx=null;
    });
    return {captured: victims.length};
  }
  return null;
}

// --- Input + Flow -----------------------------------------------------------
canvas.addEventListener("mousemove", e=>{
  // could implement hover highlights later
});

canvas.addEventListener("click", e=>{
  if (!G || G.winner) return;
  const pl = currentPlayer();
  if (pl.isBot) return; // humans only
  if (G.dice==null) return; // need a roll first

  // determine which token clicked
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);

  // enumerate token clickable circles
  const clickables = [];
  pl.tokens.forEach((tk, ti)=>{
    let cx=null, cy=null;
    if (tk.state==="base") {
      const [c,r] = Board.bases[pl.id][ti];
      const {x,y,w,h} = cellRect(c,r);
      cx = x+w/2; cy = y+h/2;
    } else if (tk.state==="main") {
      const [c,r] = Board.main[tk.mainIdx];
      const {x,y,w,h} = cellRect(c,r);
      cx = x+w/2; cy = y+h/2;
    } else if (tk.state==="homepath") {
      const [c,r] = Board.homePaths[pl.id][tk.homeIdx];
      const {x,y,w,h} = cellRect(c,r);
      cx = x+w/2; cy = y+h/2;
    } else return;
    clickables.push({ti, cx, cy});
  });

  for (const it of clickables) {
    const dx = mx - it.cx, dy = my - it.cy;
    if (dx*dx + dy*dy <= (cfg.tokenR+6)*(cfg.tokenR+6)) {
      // check legality
      if (legalMovesForToken(pl, pl.tokens[it.ti], G.dice) > 0) {
        const res = applyMove(pl, it.ti, G.dice);
        G.history.push({player:pl.name, token: it.ti, dice:G.dice, action:res});
        postMove(pl, res);
      }
      break;
    }
  }
  render();
});

rollBtn.addEventListener("click", ()=>{
  if (!G || G.winner) return;
  const pl = currentPlayer();
  if (pl.isBot) return;

  doRoll();
});

function doRoll(){
  const pl = currentPlayer();
  G.dice = 1 + Math.floor(Math.random()*6);
  diceFace.textContent = ["⚀","⚁","⚂","⚃","⚄","⚅"][G.dice-1];

  // chained 6 rule (3 sixes -> bust)
  if (G.dice === 6) {
    G.rollsInTurn = (G.rollsInTurn || 0) + 1;
    if (G.rollsInTurn >= 3) {
      // bust
      log(`${pl.name}: लगातार 3 बार 6 → टर्न रद्द`);
      endTurn();
      return;
    }
  } else {
    // reset counter if non-6
    G.rollsInTurn = 0;
  }

  // If no legal move, auto end turn unless 6 gives extra roll chance
  if (!hasMoves(pl, G.dice)) {
    log(`${pl.name}: चलने के लिए कोई वैध प्यादा नहीं`);
    if (G.dice === 6) {
      // allow another roll
      return;
    } else {
      endTurn();
      return;
    }
  }

  // If bot, auto-play best move
  if (pl.isBot) {
    setTimeout(()=> botPlay(pl), 400);
  } else {
    // human must click a token
  }
  render();
}

function botPlay(pl){
  // Simple heuristic: prioritize (1) finishing, (2) capture, (3) enter from base, (4) progress.
  const moves = [];
  pl.tokens.forEach((tk, ti)=>{
    if (legalMovesForToken(pl, tk, G.dice) > 0) moves.push({tk,ti});
  });

  function simulateScore(tk, ti){
    // high score if finishing
    if (tk.state==="homepath") {
      const remain = 5 - tk.homeIdx;
      if (G.dice > remain) return -1;
      if (G.dice === remain+1) return 100;
      return 10;
    }
    if (tk.state==="base") {
      return (G.dice===6) ? 50 : -1;
    }
    if (tk.state==="main") {
      // capture potential
      const target = (tk.mainIdx + G.dice) % 52;
      let capScore = 0;
      if (!Board.safeIdx.includes(target)) {
        let victims = 0, friends=0;
        G.players.forEach((opl, pid)=>{
          opl.tokens.forEach(otk=>{
            if (otk.state==="main" && otk.mainIdx===target) {
              if (pid===G.players.indexOf(pl)) friends++;
              else victims++;
            }
          });
        });
        if (victims>0 && friends<2) capScore = 60;
      }
      return 20 + capScore;
    }
    return 0;
  }

  moves.sort((a,b)=> simulateScore(b.tk,b.ti) - simulateScore(a.tk,a.ti));
  if (moves.length>0) {
    const best = moves[0];
    const res = applyMove(pl, best.ti, G.dice);
    G.history.push({player:pl.name, token: best.ti, dice:G.dice, action:res});
    postMove(pl, res);
  } else {
    endTurn();
  }
  render();
}

function postMove(pl, res){
  // Extra roll on six unless finished with the roll? Standard Ludo grants extra roll on any 6.
  if (G.dice === 6) {
    log(`${pl.name}: 6 पर एक और मौका`);
    // keep turn; but if just finished, still roll again (common variant)
    G.dice = null;
    render();
    if (pl.isBot) setTimeout(()=>doRoll(), 350);
    return;
  }
  // else end turn
  endTurn();
}

function endTurn(){
  // Check win
  if (currentPlayer().finished === 4) {
    G.winner = currentPlayer();
    log(`🏆 ${G.winner.name} जीत गए!`);
    rollBtn.disabled = true;
    return;
  }
  // next player
  G.turn = (G.turn + 1) % G.players.length;
  G.dice = null;
  G.rollsInTurn = 0;

  updateStatus();
  // If next is bot, auto roll
  if (currentPlayer().isBot) {
    setTimeout(()=>{ doRoll(); }, 450);
  }
}

function updateStatus(){
  const pl = currentPlayer();
  turnInfo.textContent = `टर्न: ${pl.name}${pl.isBot ? " (बॉट)" : ""}`;
  rollBtn.disabled = !!pl.isBot;
  if (pl.isBot) diceFace.textContent = "🤖";
}

function log(msg){
  console.log(msg);
}

// --- New game & render ------------------------------------------------------
function newGame(){
  const players = parseInt(playerCountSel.value, 10);
  const bots = Math.min(parseInt(botCountSel.value, 10), players-1);
  G = makeGame(players, bots);
  updateStatus();
  diceFace.textContent = "—";
  render();

  // If first player is bot, start automatically
  if (currentPlayer().isBot) setTimeout(()=>doRoll(), 500);
}

function render(){
  drawBoard();
  drawTokens();
}

newGameBtn.addEventListener("click", newGame);

// first init
newGame();
