/** Runs in <head> before the first paint: the saved choice, else the device's setting, and it
 *  follows the device while no choice is saved. Without JavaScript the page stays light. */
export const THEME =
  "(function(){var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');" +
  "function a(){var c=null;try{c=localStorage.getItem('theme')}catch(e){}" +
  "d.dataset.theme=c==='dark'||(c!=='light'&&m.matches)?'dark':'light'}" +
  "a();m.addEventListener('change',a);window.__applyTheme=a})()";
