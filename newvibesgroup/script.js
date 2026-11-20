document.getElementById('contactForm').addEventListener('submit', function(event) {
    event.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const message = document.getElementById('message').value;

    // Ici, vous pouvez ajouter le code pour envoyer les données du formulaire à un serveur
    console.log('Nom:', name);
    console.log('Email:', email);
    console.log('Message:', message);

    // Réinitialiser le formulaire
    document.getElementById('contactForm').reset();
});
