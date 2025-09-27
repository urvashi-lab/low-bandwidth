const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pdfPoppler = require("pdf-poppler");
const { execFile, exec } = require("child_process");
const { classroomState } = require("../state/classroomState");

async function convertPdfToImages(pdfPath, outDir, io, classroomId) {
  console.log(`Starting PDF conversion for ${classroomId}`);
  const startTime = Date.now();
  
  const opts = {
    format: "png",
    out_dir: outDir,
    out_prefix: "page",
    page: null,
  };
  
  await pdfPoppler.convert(pdfPath, opts);
  let files = fs
    .readdirSync(outDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
      const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
      return numA - numB;
    });
    
  if (!files.length) throw new Error(`No slides generated from ${pdfPath}`);
  
  io.emit("total-slides", { classroomId, totalSlides: files.length });
  console.log(`Found ${files.length} slides, starting parallel conversion`);
  
  const images = [];
  classroomState.preloadedSlides = new Set();
  
  // Process slides in parallel batches for better performance
  const batchSize = 3; // Process 3 slides at a time
  const batches = [];
  
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} slides)`);
    
    // Process batch in parallel
    const batchPromises = batch.map(async (file, batchOffset) => {
      const globalIndex = batchIndex * batchSize + batchOffset;
      const filePath = path.join(outDir, file);
      const outputFilename = `slide-${globalIndex + 1}.webp`;
      const outPath = path.join(outDir, outputFilename);
      
      try {
        // Optimized image processing with better compression
        await sharp(filePath)
          .resize({ width: 1024, height: 768, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75, effort: 4 }) // Better compression with effort 4
          .toFile(outPath);
        
        // Clean up original PNG immediately
        fs.unlinkSync(filePath);
        
        const slideData = {
          url: `/slides/${classroomId}/${outputFilename}`,
          name: outputFilename,
          index: globalIndex,
        };
        
        // Emit slide ready immediately
        io.emit("slide-ready", { classroomId, url: slideData.url, index: globalIndex });
        
        // Preload first few slides
        if (globalIndex < 3) {
          classroomState.preloadedSlides.add(globalIndex);
          io.emit("slide-preloaded", {
            classroomId,
            slideIndex: globalIndex,
            url: slideData.url,
            timestamp: Date.now(),
          });
        }
        
        return slideData;
      } catch (error) {
        console.error(`Error processing slide ${globalIndex + 1}:`, error);
        throw error;
      }
    });
    
    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    images.push(...batchResults);
    
    // Emit progress update
    const progress = Math.round(((batchIndex + 1) / batches.length) * 100);
    io.emit("conversion-progress", { 
      classroomId, 
      progress, 
      completedSlides: images.length,
      totalSlides: files.length 
    });
  }
  
  const endTime = Date.now();
  console.log(`PDF conversion completed in ${endTime - startTime}ms for ${images.length} slides`);
  
  return images;
}

function convertPptToPdf(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Starting PPTX to PDF conversion: ${inputPath}`);
    const startTime = Date.now();
    
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // Try typical Windows path first, then fallback to PATH 'soffice'
    const winSoffice = path.join(
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
    );
    const bin = fs.existsSync(winSoffice) ? winSoffice : "soffice";

    const args = [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outputDir,
      inputPath,
    ];

    const child = execFile(
      bin,
      args,
      { windowsHide: true },
      (err, stdout, stderr) => {
        const endTime = Date.now();
        console.log(`PPTX conversion completed in ${endTime - startTime}ms`);
        
        if (err) {
          // Provide clearer guidance if soffice missing
          if (err.code === "ENOENT") {
            return reject(
              new Error(
                "LibreOffice not found. Install it and ensure 'soffice' is on PATH or at C\\Program Files\\LibreOffice\\program\\soffice.exe."
              )
            );
          }
          return reject(
            new Error(`PPTX conversion failed: ${stderr || err.message}`)
          );
        }

        const inputBaseName = path.basename(inputPath, path.extname(inputPath));
        const generatedPdfPath = path.join(outputDir, inputBaseName + ".pdf");
        
        // Reduced timeout for faster feedback
        setTimeout(() => {
          try {
            if (fs.existsSync(generatedPdfPath)) {
              if (generatedPdfPath !== outputPath)
                fs.renameSync(generatedPdfPath, outputPath);
              console.log(`PPTX conversion successful: ${outputPath}`);
              resolve();
            } else {
              reject(
                new Error(
                  `PDF not generated at expected location: ${generatedPdfPath}`
                )
              );
            }
          } catch (e) {
            reject(new Error(`PPTX post-processing failed: ${e.message}`));
          }
        }, 500); // Reduced from 1000ms to 500ms
      }
    );

    // Reduced timeout for faster failure detection
    setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      reject(new Error("LibreOffice conversion timeout (30s)"));
    }, 30000); // Reduced from 45000ms to 30000ms
  });
}

module.exports = { convertPdfToImages, convertPptToPdf };
