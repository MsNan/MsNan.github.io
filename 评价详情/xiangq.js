$(function(){
	var imglist = $(".pjnr img");
	// console.log(imglist);
	$(".pjnr").on("click","img",function(){
		$(".full").css("visibility","visible");
		for(var i =0; i<imglist.length; i++){
			$(".pjnr img:eq("+i+")").attr("src");
			// console.log($(".pjnr img:eq("+i+")").attr("src"));
			console.log($(".pjnr img:eq("+i+")").attr("src"));
			//功能未完成
		}
	});
	$(".full").click(function(){
		$(".full").css("visibility","hidden");
	})

	var mySwiper = new Swiper('.full',{
	effect : 'fade',
	fade: {
	  crossFade: false,
	}
	});
})