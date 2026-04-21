document.addEventListener('DOMContentLoaded', () => {
    // スクロールアニメーションのための Intersection Observer
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15 // 要素が15%見えたらトリガー
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('section-visible');
            }
        });
    }, observerOptions);

    const hiddenSections = document.querySelectorAll('.section-hidden');
    hiddenSections.forEach(section => {
        observer.observe(section);
    });

    // マウスカーソル移動に応じた背景の微細なパララックス効果
    document.addEventListener('mousemove', (e) => {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        
        const blob = document.querySelector('.blob-bg');
        if(blob) {
            blob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
        }
    });
});
