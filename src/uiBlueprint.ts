import './styles/ui-blueprint.css';

export function mountBlueprint(root: HTMLElement) {
  root.innerHTML = `
    <div class="blueprint-shell">
      <header class="bp-header"><div class="bp-level"><span>LEVEL 4 / 20</span><strong>1 / 4</strong></div><div class="bp-actions"><span class="bp-coins">● 70</span><button class="bp-icon" aria-label="Open settings">⚙</button></div></header>
      <div class="bp-progress"><i></i></div>
      <main class="bp-main">
        <section class="bp-board" aria-label="Answer board"><div class="bp-board-label"><span>Find the words</span><b>1 solved</b></div><div class="bp-answers"><div class="bp-answer solved"><span>S</span><span>T</span><span>A</span><span>R</span></div><div class="bp-answer"><i></i><i></i><i></i><i></i></div><div class="bp-answer"><i></i><i></i><i></i></div><div class="bp-answer"><i></i><i></i><i></i></div></div></section>
        <div class="bp-feedback" role="status"><b>Cleared</b><span>Make a word from the letters</span></div>
        <section class="bp-wheel" aria-label="Letter wheel"><span class="bp-wheel-ring"></span><div class="bp-center">RATS</div><button style="--x:50%;--y:11%">R</button><button style="--x:88%;--y:50%">T</button><button style="--x:50%;--y:89%">A</button><button style="--x:12%;--y:50%">S</button></section>
        <div class="bp-controls"><button class="bp-submit">Submit</button><button>Clear</button><button>Shuffle</button><button>Hint</button></div>
        <section class="bp-bonus"><span>★ BONUS</span><strong>RAT</strong><strong>SAT</strong><small>+1 each</small></section>
      </main><div class="bp-sheet-preview"><span class="bp-grab"></span><b>Quick settings</b><span>Sound &nbsp; On</span></div>
    </div>`;
}
