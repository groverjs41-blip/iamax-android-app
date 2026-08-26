// Passive click guard for Google login pages.
// Keeps sensitive controls protected while allowing legitimate recovery options.

function normalizeButtonText(button) {
    return [
        button.textContent,
        button.getAttribute('aria-label'),
        button.getAttribute('title')
    ].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isAllowedGoogleAction(button) {
    const text = normalizeButtonText(button);
    const isNextContainer = button.closest('[id*="next" i], [id*="Next" i], [id*="submit" i], #identifierNext, #passwordNext, #totpNext');
    const isSubmit = button.type === 'submit';
    const isNextText = text.includes('siguiente') || text.includes('next') || text.includes('continuar') || text.includes('aceptar');
    const isRecoveryOption = text.includes('probar') || text.includes('otro metodo') || text.includes('otra forma') || text.includes('mas formas') || text.includes('otras maneras') || text.includes('try another') || text.includes('another way') || text.includes('more ways');
    const isIAmaxBtn = button.id === "iamax-inject-btn";

    return Boolean(isNextContainer || isSubmit || isNextText || isRecoveryOption || isIAmaxBtn);
}

document.addEventListener('click', (event) => {
    if (event.target.matches('input[type="checkbox"]') || event.target.closest('input[type="checkbox"]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    const button = event.target.closest('button');
    if (button && !isAllowedGoogleAction(button)) {
        event.preventDefault();
        event.stopPropagation();
    }
}, true);
