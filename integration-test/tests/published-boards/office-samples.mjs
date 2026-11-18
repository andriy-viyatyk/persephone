import { crc32 } from "node:zlib";

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{{relationships}}</Relationships>`;

function xml(content) {
    return Buffer.from(content, "utf8");
}

function makeZip(entries) {
    const sortedEntries = Object.entries(entries).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const [name, content] of sortedEntries) {
        const nameBytes = Buffer.from(name, "utf8");
        const data = Buffer.isBuffer(content) ? content : xml(content);
        const checksum = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x0021, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, nameBytes, data);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x0021, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBytes.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBytes);
        offset += localHeader.length + nameBytes.length + data.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(sortedEntries.length, 8);
    end.writeUInt16LE(sortedEntries.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralDirectory, end]);
}

async function writeSample(ctx, boardId, filename, entries) {
    const filePath = ctx.fixture(`boards-samples/${boardId}/${filename}`);
    await ctx.app.fs.mkdir(ctx.fixture(`boards-samples/${boardId}`));
    const bytes = makeZip(entries);
    await ctx.script(`await app.fs.writeBinary(${JSON.stringify(filePath)}, Buffer.from(${JSON.stringify(bytes.toString("base64"))}, "base64"));`);
    return filePath;
}

export async function writeWordSample(ctx) {
    return writeSample(ctx, "word-viewer", "sample.docx", {
        "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
        "_rels/.rels": ROOT_RELS.replace("{{relationships}}", `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`),
        "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Sample Heading</w:t></w:r></w:p><w:p><w:r><w:t>First sample paragraph.</w:t></w:r></w:p><w:p><w:r><w:t>Second sample paragraph.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
        "word/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    });
}

function inlineCell(reference, value) {
    return `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function numberCell(reference, value) {
    return `<c r="${reference}"><v>${value}</v></c>`;
}

export async function writeExcelSample(ctx) {
    return writeSample(ctx, "excel-viewer", "sample.xlsx", {
        "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        "_rels/.rels": ROOT_RELS.replace("{{relationships}}", `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`),
        "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Details" sheetId="2" r:id="rId2"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
        "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B4"/><sheetData><row r="1">${inlineCell("A1", "Item")}${inlineCell("B1", "Count")}</row><row r="2">${inlineCell("A2", "Apples")}${numberCell("B2", 2)}</row><row r="3">${inlineCell("A3", "Oranges")}${numberCell("B3", 3)}</row><row r="4">${inlineCell("A4", "Total")}<c r="B4"><f>SUM(B2:B3)</f><v>5</v></c></row></sheetData></worksheet>`,
        "xl/worksheets/sheet2.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1">${inlineCell("A1", "Field")}${inlineCell("B1", "Value")}</row><row r="2">${inlineCell("A2", "Source")}${inlineCell("B2", "Details only")}</row></sheetData></worksheet>`,
    });
}

const PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PACKAGE_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function slideXml(title, body) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${title}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${body}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export async function writePowerPointSample(ctx) {
    const typeOverrides = [
        ["ppt/presentation.xml", "presentation.main+xml"],
        ["ppt/presProps.xml", "presProps+xml"],
        ["ppt/viewProps.xml", "viewProps+xml"],
        ["ppt/tableStyles.xml", "tableStyles+xml"],
        ["ppt/slideMasters/slideMaster1.xml", "slideMaster+xml"],
        ["ppt/slideLayouts/slideLayout1.xml", "slideLayout+xml"],
        ["ppt/slides/slide1.xml", "slide+xml"],
        ["ppt/slides/slide2.xml", "slide+xml"],
    ].map(([part, type]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}"/>`).join("");
    const themeOverride = `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`;
    const appProperties = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>2</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Slide Titles</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Sample Overview</vt:lpstr><vt:lpstr>Sample Details</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
    const entries = {
        "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${typeOverrides}${themeOverride}</Types>`,
        "_rels/.rels": ROOT_RELS.replace("{{relationships}}", `<Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`),
        "docProps/app.xml": appProperties,
        "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="en-US"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL_NS}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${OFFICE_REL_NS}/slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="${OFFICE_REL_NS}/presProps" Target="presProps.xml"/><Relationship Id="rId5" Type="${OFFICE_REL_NS}/viewProps" Target="viewProps.xml"/><Relationship Id="rId6" Type="${OFFICE_REL_NS}/tableStyles" Target="tableStyles.xml"/></Relationships>`,
        "ppt/presProps.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}"><p:showPr><p:present/></p:showPr></p:presentationPr>`,
        "ppt/viewProps.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}" lastView="sldView"><p:normalViewPr/><p:slideViewPr/><p:notesTextViewPr/><p:sorterViewPr/></p:viewPr>`,
        "ppt/tableStyles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="${DRAWING_NS}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
        "ppt/slideMasters/slideMaster1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`,
        "ppt/slideLayouts/slideLayout1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL_NS}" xmlns:p="${PRESENTATION_NS}" type="titleAndContent" preserve="1"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
        "ppt/theme/theme1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${DRAWING_NS}" name="Sample"><a:themeElements><a:clrScheme name="Sample"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Sample"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Sample"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
        "ppt/slides/slide1.xml": slideXml("Sample Overview", "First slide text."),
        "ppt/slides/slide2.xml": slideXml("Sample Details", "Second slide text."),
        "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
        "ppt/slides/_rels/slide2.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    };
    return writeSample(ctx, "powerpoint-viewer", "sample.pptx", entries);
}
