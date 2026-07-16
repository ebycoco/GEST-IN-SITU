import os
from PIL import Image, ImageDraw

def create_squircle_mask(size, radius):
    """Crée un masque squircle (carré aux bords arrondis) parfait en niveaux de gris."""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    # Dessine un rectangle aux coins arrondis
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask

def process_logo(input_path, output_ico_path):
    print(f"Chargement de l'image source : {input_path}")
    img = Image.open(input_path).convert("RGBA")
    
    width, height = img.size
    print(f"Dimensions d'origine : {width}x{height}")
    
    # Le logo central de icone.jpeg est inscrit dans un rectangle bleu arrondi
    # Mais l'image contient des bandes blanches sur les côtés droit et gauche
    # Nous allons recadrer l'image sur le squircle bleu central.
    # Pour icone.jpeg, le squircle bleu a une hauteur égale à l'image (1080px),
    # et sa largeur est également de 1080px. Le reste est constitué de bandes blanches.
    
    # Recadrage au centre (carré de côté égal à la hauteur de l'image)
    size = min(width, height)
    left = (width - size) // 2
    top = (height - size) // 2
    right = left + size
    bottom = top + size
    
    # On applique un léger crop supplémentaire de sécurité de 4 pixels de chaque côté
    # pour éviter absolument toute ligne blanche résiduelle sur les bords verticaux du squircle bleu.
    security_crop = 4
    cropped_img = img.crop((left + security_crop, top + security_crop, right - security_crop, bottom - security_crop))
    size = cropped_img.width
    
    # Redimensionnement et lissage du masque
    # Pour éviter le crénelage (aliasing) sur les bords, nous créons le masque à une taille 4 fois supérieure
    # puis nous le réduisons avec un filtre LANCZOS de haute qualité.
    oversize = size * 4
    mask_large = create_squircle_mask(oversize, radius=int(oversize * 0.22)) # 22% de rayon pour le squircle
    mask = mask_large.resize((size, size), Image.Resampling.LANCZOS)
    
    # Application du masque sur le canal Alpha
    r, g, b, a = cropped_img.split()
    
    # Création de la nouvelle image avec canal Alpha basé uniquement sur le masque squircle
    final_img = Image.merge("RGBA", (r, g, b, mask))
    
    # Génération des différentes tailles pour le fichier ICO multi-résolution
    sizes = [16, 32, 48, 64, 128, 256]
    icon_images = []
    
    for s in sizes:
        # Redimensionnement haute qualité pour chaque résolution du conteneur ICO
        resized = final_img.resize((s, s), Image.Resampling.LANCZOS)
        icon_images.append(resized)
    
    print(f"Sauvegarde du fichier icône multi-résolution dans : {output_ico_path}")
    # Enregistrement au format ICO avec toutes ses couches
    icon_images[0].save(
        output_ico_path,
        format='ICO',
        sizes=[(s, s) for s in sizes],
        append_images=icon_images[1:]
    )
    print("Traitement terminé avec succès !")

if __name__ == "__main__":
    input_img = r"d:\Espace travail\GEST_IN-SITU_CARTE_ABOBO_V2\icone.jpeg"
    output_ico = r"d:\Espace travail\GEST_IN-SITU_CARTE_ABOBO_V2\resources\icon.ico"
    
    # S'assurer que le dossier de sortie existe
    os.makedirs(os.path.dirname(output_ico), exist_ok=True)
    
    process_logo(input_img, output_ico)
