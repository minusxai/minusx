const MAX_OBSERVER_TIME = 3000


// Observe the document for the addition of the script tag
export const initObservePosthog = () => {
  const observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(function (node) {
          const substrToCheck = "index-T6ZJDWBT.js"
          if (node.nodeName === 'SCRIPT' ) {
            let scriptNode: HTMLScriptElement = node as HTMLScriptElement
            if (scriptNode.src.includes(substrToCheck)) {
              console.log('<><><>Found script! removing observer')
              observer.disconnect();  // Stop observing once we've found and processed the script
            }
          }
        });
      }
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.onload = function () {
    console.log('Removing observer')
    observer.disconnect();
  }
  setTimeout(() => {
    console.log('Removing observer')
    observer.disconnect();
  }, MAX_OBSERVER_TIME)
  console.log('Started observing')
}
