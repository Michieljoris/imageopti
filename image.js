/*global exports:false __dirname:false module:false require:false */
/*jshint strict:false unused:true smarttabs:true eqeqeq:true immed: true undef:true*/
/*jshint maxparams:7 maxcomplexity:8 maxlen:150 devel:true newcap:false*/ 


var fs = require('fs-extra'),
    Path = require('path'),
    util = require('util'),
    child_process = require('child_process'),
    spawn = child_process.spawn,
    smushit = require('node-smushit'),
    gm = require('gm'),
    tmp  = require('tmp'),
    Which = require('which'),
    VOW = require('./vow'),
    filesize = require('filesize')

;

require('colors');

var log;
var options;

var  pngExts = [".png", ".bmp", ".gif", ".pnm", ".tiff"],
    jpgExts = [".jpg", "jpeg"],
    cmds = {
        //jpeg
        jpegtran: { name: 'jpegtran'},
        jpegoptim: { name: 'jpegoptim' },
        //png
        pngquant: { name: 'pngquant' },
        optipng: { name: 'optipng' },
        pngout: { name: 'pngout-static' },
        resize: { name: ''}
    }
;

function getCmdPath(cmd) { 
    var vow = VOW.make();
    Which(cmds[cmd].name, function(err, path) {
        if (!err) {
            cmds[cmd].path = path;
            vow.keep(path);   
        }
        else vow.breek(err);
    });
    return vow.promise;
}

function initCmds() {
    var vows = [];
    Object.keys(cmds).forEach(function(c) {
        vows.push(getCmdPath(c));
    });
    return VOW.any(vows);
}

function debug() {
    if (options.verbose) console.log.apply(console, arguments);
    log.push(arguments);
}

function recurse(filePath, fileName, callback) {
    var path = Path.join(filePath, fileName);
    var stats = fs.statSync(path);
    if (stats.isDirectory()) 
        try{
            fs.readdirSync(path).forEach(function(fileName) {
                recurse(path, fileName, callback);
            }); 
        } catch(e) { debug("ERROR"); }
    else callback(path, fileName, stats.size);
}

function getTmpFile() {
    var vow = VOW.make();
    tmp.file(function(err, path) {
        if (err) {
            console.log("Couldn't create temp file..", err);
            vow.breek(err);
            return;
        }
        vow.keep(path);
    }); 
    return vow.promise;
}

function cp(file) {
    var vow = VOW.make();
    fs.copy(file.src, file.dest, function(err) {
        if (err) { vow.breek(err); return; }
        vow.keep(file);
    });
    return vow.promise;
}

function optimize(cmd, file) {
    return getTmpFile()
        .when(
            function(tmp) {
                return cp({ src: file.src, dest: tmp });
            })
        .when( function(copied) {
            debug('Processing ' + copied.dest + ' with ' + cmd);
            cmd = cmds[cmd];
            return cmd.exec(copied.dest);
        })
        .when(
            function(tmp) {
                var newSize = fs.statSync(tmp).size;
                if (newSize < file.size.current) {
                    file.size[cmd.name] = file.size.current = fs.statSync(tmp).size;
                    file.dest = options.out ? Path.join(options.out, Path.basename(file)) : file.src;
                    file.src = tmp;
                    file.copied = true;
                    return cp(file);
                } 
                else return VOW.kept(file);
            }
        );
}

function getImagePaths(dir) {
    var png = [];
    var jpg = [];

    if (!Array.isArray(dir)) dir = [dir];
    dir.forEach(function(d) {
        recurse(d, '', function(filePath, fileName, size) {
            var file = { path: filePath, src: filePath, size: { original: size, current: size }};
            if (!!~pngExts.indexOf(Path.extname(fileName).toLowerCase())) 
                png.push(file);   
            else if (!!~jpgExts.indexOf(Path.extname(fileName).toLowerCase())) 
                jpg.push(file);   
        }); 
    }); 
    return {
        png: png, jpg: jpg
    }; 
}

function report(files) {
    var oldSize = 0;
    var currentSize = 0;
    var result = { log: [] };
    function iter(arr) {
        arr.forEach(function(f) {
            oldSize += f.size.original;
            currentSize += f.size.current;
            if (f.size.current < f.size.original) {
                var savings = 100 - Math.floor(f.size.current/f.size.original * 100);
                var str = 'Optimized ' + f.path.cyan +
                    ' [saved ' + savings + '% ' + filesize(f.size.original) + ' → ' + filesize(f.size.current) + ']';
                debug(str);
                result.log.push(str);
                
            }
        }); 
    }
    iter(files.png);
    iter(files.jpg);
    var savings = 0;
    if (currentSize < oldSize) {
        savings = 100 - Math.floor(currentSize/oldSize * 100);
        debug('Optimized. '.green + 
              ' [saved ' + savings + '% ' + filesize(oldSize) + ' → ' + filesize(currentSize) + ']');
    }
    else debug('No image can be made smaller'.green);
    result.size = {
        original: oldSize,
        current: currentSize
    };
    
    result.savings = savings;
    return result;
}

function mySmushit(files) {
    var vow = VOW.make();
    var queue = [];
    options.png.forEach(function(c) {
        files.png.forEach(function(f) {
            queue.push({ cmd: c, file: f });
        });
    }); 
    options.jpg.forEach(function(c) {
        files.jpg.forEach(function(f) {
            queue.push({ cmd: c, file: f });
        });
    }); 
    var count = 0;
    var max = queue.length;
    var concurrent = options.concurrent || max;
    function take(n) {
        var vows = [];
        while (n && count<max) {
            vows.push(
                optimize(queue[count].cmd, queue[count].file));
            n--;
            count++;
        }
        return vows;
    }

    function recur() {
        VOW.any(take(concurrent) )
            .when(
                function() {
                    if (count<max) recur();
                    else {
                        vow.keep(files);
                    }
                });
    }
    recur();
    return vow.promise;
} 
    
function doSmushit(files) {
    var list = [];
    var lookup = {};
    files.png.forEach(function(f) {
        list.push(f.path);
        lookup[f.path] = f;
    });
    files.jpg.forEach(function(f) {
        list.push(f.path);
        lookup[f.path] = f;
    });
    // console.log(lookup);
    // return;
    var vow = VOW.make(); 
    //smash images and register callbacks
    smushit.smushit(list, {
        recursive: options.recurse,
        onItemStart: function(item){
            // console.log('start:', item);
        },
        onItemComplete: function(e, item, response){
            if (!e && !response.error) {
                lookup[item].size.smushit = lookup[item].size.current = response.dest_size;
            }
            else { debug(response.error); }
        },
        onComplete: function(reports){
            debug('complete:', reports);
            vow.keep(files);
        }
        ,verbose: options.verbose
        // ,service: 'http://my-custom-domain-service/'
    });
    return vow.promise;
}


function process(dir, someOptions) {
    var vow = VOW.make();
    log = [];
    options = someOptions ||
        {
            // png: 'pngopti',
            png: ['pngquant', 'optipng']
            // ,jpg: 'jpegtran'
            ,destDir: ''
            // recurse: true,
            // resize: {w: 100, h: 100}
            // ,smushit: true
            ,quality: 50 //jpegoptim
            ,min: 60, max: 80 //pngquant
            ,colors: 256
            ,concurrent: 1
            ,verbose: true 
        };
    debug(options);
    options.png = Array.isArray(options.png) ? options.png : (options.png ? [options.png] : []);
    options.jpg = Array.isArray(options.jpg) ? options.jpg : (options.jpg ? [options.jpg] : []);
    initCmds()
        .when(
            function() {
                var files = getImagePaths(dir);
                if (options.smushit)  {
                    return doSmushit(files);
                } 
                else return mySmushit(files);
            })
        .when(
            function (files) {
                vow.keep( report(files) );
            });
    return vow.promise;
}


// Resize the image.

// options
// %, @, !, < or > see the GraphicsMagick docs for details
// gm("img.png").resize(width [, height [, options]])
// To resize an image to a width of 40px while maintaining aspect ratio: gm("img.png").resize(40)

// To resize an image to a height of 50px while maintaining aspect ratio: gm("img.png").resize(null, 50)

// To resize an image to a fit a 40x50 rectangle while maintaining aspect ratio: gm("img.png").resize(40, 50)

// To override the image's proportions and force a resize to 40x50: gm("img.png").resize(40, 50, "!")


function doCmd(cmd, args, src) {
    var vow = VOW.make();
    if (!cmd.path) {
        vow.breek('Command ' + cmd.name+ ' not found on the system.');
    }
    else {  args = args.concat(src);
            var c = spawn(cmd.path, args);
            c.on('exit', function(code) {
                if (code) vow.breek(code);
                else {
                    debug(cmd.name + ' is finished.');
                    vow.keep(src);   
                }
            });
         } 
    return vow.promise;
}

cmds.resize.exec = function(src) {
    var resize = options.resize;
    var vow = VOW.make();
    debug('Resizing: ', src);
    gm(src)
        .autoOrient()
        .resize(resize.w, resize.h)
        .write(src, function (err) {
            if (err) { debug(err); return vow.breek(err); }
            debug('Resized ' + src);
            return vow.keep(src);
        });
    return vow.promise;
};

cmds.jpegtran.exec = function(src) {
    var args =  ['-copy', 'none', '-optimize', '-outfile', src];
    return doCmd(this, args, src);
}

cmds.pngquant.exec = function(src) {
    var args = ['--ext=.png', '--force', '--quality=60-80', 256, '--'];
    return doCmd(this, args, src);
};

cmds.jpegoptim.exec = function(src) {
    var args =  ['--strip-all', '-f'];
    if (options.quality) args = args.concat(['--max', options.quality]);
    return doCmd(this, args, src);
};

cmds.optipng.exec = function(src) {
    return doCmd(this, [], src);
};

cmds.pngout.exec = function(src) {
    var args = ['-v', '-y'];
    return doCmd(this, args, src);
};

module.exports = process;

process('/home/michieljoris/temp/test').when(
    function(result) {
        console.log('la', result);
    }
);
