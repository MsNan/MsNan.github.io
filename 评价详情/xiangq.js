$(function(){
	var imglist = $(".pjnr img");
	// console.log(imglist);
	$(".pjnr").on("click","img",function(){
		$(".full").css("display","block");
		for(var i =0; i<imglist.length; i++){
			$(".pjnr img:eq("+i+")").attr("src");
			// console.log($(".pjnr img:eq("+i+")").attr("src"));
			console.log($(this).attr("src"));
			//功能未完成
		}
	})
})