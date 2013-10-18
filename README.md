imageopti
_____________

Wrapper for miscellaneous linux image utilities.

Implemented at the moment are jpegtran, jpegoptim, pngquant, pngout
and imagemagick resize.

Or alternatively use smushit,

var opti = require('path/to/imageopti');

var vow = opti(file or dir [, [options]])
    
options:	

        {
            //png: 'optipng', // str
            png: ['pngquant', 'optipng'], //or array
            jpg: 'jpegtran', //or jpegoptim, or both as an array
            ,destDir: '' //where to save the modified files, falsy is replace
            // recurse: true,
            // resize: {w: 100, h: 100}
            // ,smushit: true //if true all processing goes through smushit
            ,quality: 50 //for jpegoptim only
            ,min: 60, max: 80 //for pngquant
            ,colors: 256 //for pngquant
            ,concurrent: 1 //number of concurrent processes
			//if concurrent is falsy everything will be async
            ,verbose: true 
        };
		
The returned vow promises an object such as:

	{ log: [list of messages describing what happened],
	  size: { original: 437851, current: 437851 },
	  savings: 0 }
	  
	  

	
		
		
		
		

