import { renderPdfCoverImageWithRecovery } from '../../src/pdf_export.js';

export async function runPdfCoverTaintRecoveryChecks(test,{assert}) {
  await test('PDF cover taint retries on a fresh canvas without losing the image',async()=>{
    const documentProto=Document.prototype;
    const originalCreate=documentProto.createElement;
    const originalGetImageData=CanvasRenderingContext2D.prototype.getImageData;
    const originalToBlob=HTMLCanvasElement.prototype.toBlob;

    let firstCanvas=null;
    let createdCanvases=0;
    let getImageDataThrows=0;
    let toBlobThrows=0;

    documentProto.createElement=function(tagName,options){
      const el=originalCreate.call(this,tagName,options);
      if(String(tagName).toLowerCase()==='canvas'){
        createdCanvases++;
        if(!firstCanvas) firstCanvas=el;
      }
      return el;
    };

    CanvasRenderingContext2D.prototype.getImageData=function(...args){
      if(this.canvas===firstCanvas){
        getImageDataThrows++;
        throw new DOMException('Tainted canvases may not be exported.','SecurityError');
      }
      return originalGetImageData.apply(this,args);
    };

    HTMLCanvasElement.prototype.toBlob=function(...args){
      if(this===firstCanvas){
        toBlobThrows++;
        throw new DOMException('Tainted canvases may not be exported.','SecurityError');
      }
      return originalToBlob.apply(this,args);
    };

    try{
      const image=await renderPdfCoverImageWithRecovery({
        contentPageCount:1,
        filename:'cover-taint-probe.pdf',
      });
      assert(createdCanvases===2,`expected poisoned canvas + fresh retry, got ${createdCanvases}`);
      assert(getImageDataThrows===1,`lossless path poison count=${getImageDataThrows}`);
      assert(toBlobThrows===1,`JPEG fallback poison count=${toBlobThrows}`);
      assert(image?.bytes?.length>1000,`recovered cover image bytes=${image?.bytes?.length}`);
      assert(image.width>0&&image.height>0,'recovered cover has invalid dimensions');
      assert(image.filter==='FlateDecode'||image.filter==='DCTDecode',`unexpected filter ${image.filter}`);
      return {
        createdCanvases,
        bytes:image.bytes.length,
        filter:image.filter,
        getImageDataThrows,
        toBlobThrows,
      };
    }finally{
      documentProto.createElement=originalCreate;
      CanvasRenderingContext2D.prototype.getImageData=originalGetImageData;
      HTMLCanvasElement.prototype.toBlob=originalToBlob;
    }
  });
}
