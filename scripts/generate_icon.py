import os
from PIL import Image
from rembg import remove

def process_icon(input_path, output_path):
    print(f"Loading {input_path}...")
    try:
        # Load the original image
        input_image = Image.open(input_path)
    except Exception as e:
        print(f"Error loading image: {e}")
        return

    print("Removing background...")
    # Use rembg to remove the background (this uses a neural network for precise extraction and anti-aliasing)
    transparent_image = remove(input_image)

    print("Cropping to bounding box...")
    # Get the bounding box of the non-zero (non-transparent) regions
    bbox = transparent_image.getbbox()
    if not bbox:
        print("Error: Could not find any non-transparent pixels after background removal.")
        return
    
    # Crop the image to just the logo
    cropped_logo = transparent_image.crop(bbox)

    print("Resizing to fit within 420x420 safe zone...")
    # We want the max dimension to be 420px
    target_size = 420
    ratio = min(target_size / cropped_logo.width, target_size / cropped_logo.height)
    new_width = int(cropped_logo.width * ratio)
    new_height = int(cropped_logo.height * ratio)
    
    # Resize with high-quality Lanczos resampling
    resized_logo = cropped_logo.resize((new_width, new_height), Image.Resampling.LANCZOS)

    print("Creating 512x512 transparent canvas and centering logo...")
    # Create the final 512x512 canvas with a transparent background
    final_canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    
    # Calculate top-left coordinates to center the logo
    x = (512 - new_width) // 2
    y = (512 - new_height) // 2
    
    # Paste the resized logo onto the canvas
    # Using resized_logo as the mask to preserve transparency correctly
    final_canvas.paste(resized_logo, (x, y), resized_logo)

    print(f"Saving to {output_path}...")
    # Save the final image as a PNG
    final_canvas.save(output_path, "PNG")
    print("Done! Icon successfully generated.")

if __name__ == "__main__":
    input_file = "icone.jpeg"
    output_file = "icon.png"
    
    if not os.path.exists(input_file):
        print(f"File not found: {input_file}")
    else:
        process_icon(input_file, output_file)
