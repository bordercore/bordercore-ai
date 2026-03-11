/**
 * Trigger an animate.css animation on demand via JavaScript.
 */
export const animateCSS = (
  node: HTMLElement,
  animation: string,
  prefix = "animate__"
): Promise<string> =>
  new Promise((resolve) => {
    const animationName = `${prefix}${animation}`;
    node.classList.add(`${prefix}animated`, animationName);

    function handleAnimationEnd(event: AnimationEvent) {
      event.stopPropagation();
      node.classList.remove(`${prefix}animated`, animationName);
      resolve("Animation ended");
    }

    node.addEventListener("animationend", handleAnimationEnd as EventListener, {
      once: true,
    });
  });
